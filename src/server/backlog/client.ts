/**
 * Backlog API v2 クライアント。
 *
 * - 認証は OAuth 2.0 のアクセストークンを `Authorization: Bearer` で送る
 * - レート制限ヘッダーを記録し、429 を受けたら待機してリトライする
 * - エラーメッセージにアクセストークンが混入しないよう必ずマスクする
 *
 * Apps Script の `UrlFetchApp` は同期的に応答を返すため、このクライアントも
 * 同期で組み立てている。並列化は `UrlFetchApp.fetchAll` に相当する
 * `Fetcher`（複数リクエストをまとめて受け取る関数）へ委ねる。
 */

import { buildUrl } from '../fetcher'
import type { Fetcher, FetchRequest, FetchResponse, QueryParams, Sleeper } from '../fetcher'
import type { BacklogRateLimitEntry } from './api-types'

export class BacklogApiError extends Error {
  readonly status: number
  readonly detail: string | undefined

  constructor(status: number, message: string, detail?: string) {
    super(message)
    this.name = 'BacklogApiError'
    this.status = status
    this.detail = detail
  }
}

/**
 * リトライ待機の上限（ミリ秒）。
 *
 * Backlog のレート制限ウィンドウは 1 分だが、そこまで待つと Apps Script の
 * 実行時間を食い潰してしまう。上限を超える場合は待たずに 429 をそのまま
 * クライアントへ返し、UI 側で案内する。
 */
const MAX_RETRY_WAIT_MS = 8000

/**
 * 1 回の `fetchAll` にまとめる本数の既定値。
 *
 * Backlog の Search 区分レート制限（既定で 1 分あたり 150 リクエスト程度）を
 * 一気に使い切らないよう、まとめて投げる本数を抑えている。
 */
export const DEFAULT_BATCH_SIZE = 5

export type BacklogClientOptions = {
  space: string
  accessToken: string
  fetcher: Fetcher
  /** テストから差し替えるための待機関数。 */
  sleep?: Sleeper
  now?: () => number
  /** 429 / 5xx に対するリトライ回数の上限。 */
  maxRetries?: number
  batchSize?: number
}

/** 1 本のリクエスト。 */
export type BacklogRequest = {
  path: string
  params?: QueryParams
}

/** 画像などのバイナリ。Apps Script では Base64 で持ち回るのがもっとも扱いやすい。 */
export type BinaryContent = {
  base64: string
  contentType: string
}

/** 再試行のループ 1 周ぶんの仕分け結果。 */
type Outcome = {
  results: FetchResponse[]
  retry: number[]
  waitMs: number
  failure: BacklogApiError | null
}

/** 配列を指定の長さごとに切る。 */
function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

function describeStatus(status: number): string {
  switch (status) {
    case 400: {
      return 'Backlog へのリクエストが不正です'
    }
    case 401: {
      return 'Backlog の認証が切れています。ログインし直してください'
    }
    case 403: {
      return 'この操作を行う権限がありません'
    }
    case 404: {
      return '指定されたリソースが見つかりません'
    }
    case 429: {
      return 'Backlog のレート制限に達しました。しばらく待ってから再読込してください'
    }
    default: {
      return status >= 500 ? 'Backlog 側でエラーが発生しました' : 'Backlog API の呼び出しに失敗しました'
    }
  }
}

export class BacklogClient {
  readonly space: string
  private readonly accessToken: string
  private readonly fetcher: Fetcher
  private readonly sleep: Sleeper
  private readonly maxRetries: number
  private readonly batchSize: number
  private readonly now: () => number

  /** このクライアントが Backlog へ投げたリクエスト数。 */
  requestCount = 0
  /** 直近のレスポンスから読み取ったレート制限の状況。 */
  lastRateLimit: BacklogRateLimitEntry | null = null

  constructor(options: BacklogClientOptions) {
    this.space = options.space
    this.accessToken = options.accessToken
    this.fetcher = options.fetcher
    this.sleep =
      options.sleep ??
      (() => {
        // 既定では待たない。待ち時間はテストの都合で差し替えられるようにしてある。
      })
    this.maxRetries = options.maxRetries ?? 2
    this.batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE)
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * JSON を 1 本取得する。
   *
   * 呼び出し側が期待する型を指定して使う。返り値だけに型引数が現れるのは
   * この用途では意図どおりなので、その旨の検査は個別に外している。
   */
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  get<T>(path: string, params: QueryParams = {}): T {
    return this.getMany<T>([{ path, params }])[0]
  }

  /**
   * JSON を複数まとめて取得する。
   *
   * 返り値の並びは引数の並びと一致する。1 本でも取得できなかった場合は
   * `BacklogApiError` を投げる。
   */
  getMany<T>(requests: BacklogRequest[]): T[] {
    if (requests.length === 0) {
      return []
    }
    return this.send(requests, 'application/json').map((response) => {
      try {
        return JSON.parse(response.text()) as T
      } catch {
        throw new BacklogApiError(502, 'Backlog の応答を解釈できませんでした')
      }
    })
  }

  /** 画像などのバイナリを取得する。 */
  getBinary(path: string, params: QueryParams = {}): BinaryContent {
    return this.getBinaryMany([{ path, params }])[0]
  }

  /**
   * 画像などのバイナリをまとめて取得する。
   *
   * 1 本でも取得できなかった場合は `BacklogApiError` を投げる。アイコンのように
   * 欠けても画面が成立するものは、呼び出し側で本数を区切って捕まえる。
   */
  getBinaryMany(requests: BacklogRequest[]): BinaryContent[] {
    if (requests.length === 0) {
      return []
    }
    return this.send(requests, 'image/*').map((response) => ({
      base64: response.base64(),
      contentType: response.header('Content-Type') ?? 'image/png'
    }))
  }

  /** アクセストークンが外部に漏れないようメッセージからマスクする。 */
  private mask(text: string): string {
    if (!this.accessToken) {
      return text
    }
    return text.split(this.accessToken).join('***')
  }

  private toFetchRequest(request: BacklogRequest, accept: string): FetchRequest {
    return {
      url: buildUrl(`https://${this.space}/api/v2`, request.path, request.params ?? {}),
      headers: {
        Accept: accept,
        Authorization: `Bearer ${this.accessToken}`
      }
    }
  }

  /**
   * ヘッダーの数値を読む。未設定・空・数値でない場合は null。
   *
   * `Number(null)` は 0 になり `Number.isFinite(0)` も真なので、
   * `Number()` の結果だけで有無を判定すると「ヘッダーが無い」を
   * 「残り 0」と取り違える。
   */
  private headerNumber(response: FetchResponse, name: string): number | null {
    const raw = response.header(name)
    if (raw === null || raw.trim() === '') {
      return null
    }
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  }

  private readRateLimit(response: FetchResponse): void {
    const limit = this.headerNumber(response, 'X-RateLimit-Limit')
    const remaining = this.headerNumber(response, 'X-RateLimit-Remaining')
    const reset = this.headerNumber(response, 'X-RateLimit-Reset')
    if (limit !== null && remaining !== null && reset !== null) {
      this.lastRateLimit = { limit, remaining, reset }
    }
  }

  /** 429 を受けたときに待つべきミリ秒。待つ価値がなければ null。 */
  private retryWaitMs(response: FetchResponse, attempt: number): number | null {
    const retryAfter = this.headerNumber(response, 'Retry-After')
    if (retryAfter !== null && retryAfter > 0) {
      const ms = retryAfter * 1000
      return ms <= MAX_RETRY_WAIT_MS ? ms : null
    }
    const reset = this.headerNumber(response, 'X-RateLimit-Reset')
    if (reset !== null && reset > 0) {
      const ms = reset * 1000 - this.now()
      if (ms <= 0) {
        return 200
      }
      return ms <= MAX_RETRY_WAIT_MS ? ms : null
    }
    // ヘッダーが無い場合は指数バックオフ。
    return Math.min(MAX_RETRY_WAIT_MS, 500 * 2 ** attempt)
  }

  /**
   * この応答を待って再試行すべきなら待ち時間（ミリ秒）を返す。
   * 再試行しない場合は null。
   */
  private retryDelay(response: FetchResponse, attempt: number): number | null {
    const shouldRetry = response.status === 429 || response.status >= 500
    if (!shouldRetry || attempt >= this.maxRetries) {
      return null
    }
    return response.status === 429 ? this.retryWaitMs(response, attempt) : 500 * 2 ** attempt
  }

  private fetchBatch(requests: FetchRequest[]): FetchResponse[] {
    this.requestCount += requests.length
    try {
      return this.fetcher(requests)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      throw new BacklogApiError(502, 'Backlog への接続に失敗しました', this.mask(message))
    }
  }

  /** 応答 1 件を、成功・再試行・失敗のいずれかへ仕分ける。 */
  private classify(index: number, response: FetchResponse, attempt: number, outcome: Outcome): void {
    this.readRateLimit(response)
    if (response.status >= 200 && response.status < 300) {
      outcome.results[index] = response
      return
    }
    const wait = this.retryDelay(response, attempt)
    if (wait === null) {
      outcome.failure ??= new BacklogApiError(
        response.status,
        describeStatus(response.status),
        this.mask(response.text().slice(0, 500))
      )
      return
    }
    outcome.retry.push(index)
    outcome.waitMs = Math.max(outcome.waitMs, wait)
  }

  /**
   * まとめて投げ、429 / 5xx は待ってから投げ直す。
   *
   * 再試行の対象は失敗した分だけに絞る。全件投げ直すと、成功済みの分まで
   * レート制限を二重に消費してしまう。
   */
  private send(requests: BacklogRequest[], accept: string): FetchResponse[] {
    const results = Array.from({ length: requests.length }) as FetchResponse[]
    let pending = requests.map((_request, index) => index)

    for (let attempt = 0; ; attempt += 1) {
      const outcome: Outcome = { results, retry: [], waitMs: 0, failure: null }

      for (const batch of chunk(pending, this.batchSize)) {
        const responses = this.fetchBatch(batch.map((index) => this.toFetchRequest(requests[index], accept)))
        for (const [offset, response] of responses.entries()) {
          this.classify(batch[offset], response, attempt, outcome)
        }
      }

      if (outcome.failure) {
        throw outcome.failure
      }
      if (outcome.retry.length === 0) {
        return results
      }
      this.sleep(outcome.waitMs)
      pending = outcome.retry
    }
  }
}
