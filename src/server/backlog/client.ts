/**
 * Backlog API v2 クライアント。
 *
 * - 認証は OAuth 2.0 のアクセストークンを `Authorization: Bearer` で送る
 * - レート制限ヘッダーを記録し、429 を受けたら待機してリトライする
 * - エラーメッセージにアクセストークンが混入しないよう必ずマスクする
 */

import type { BacklogRateLimitEntry } from './api-types'

export type QueryValue = string | number | boolean | null | undefined | (string | number)[]
export type QueryParams = Record<string, QueryValue>

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

export type BacklogClientOptions = {
  space: string
  accessToken: string
  fetchImpl?: typeof fetch
  /** 429 / 5xx に対するリトライ回数の上限。 */
  maxRetries?: number
  /** テストから差し替えるための待機関数。 */
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/**
 * リトライ待機の上限（ミリ秒）。
 *
 * Backlog のレート制限ウィンドウは 1 分だが、そこまで待つとリクエストが
 * タイムアウトしてユーザー体験を損なう。上限を超える場合は待たずに
 * 429 をそのままクライアントへ返し、UI 側で案内する。
 */
const MAX_RETRY_WAIT_MS = 8_000

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export class BacklogClient {
  readonly space: string
  private readonly accessToken: string
  private readonly fetchImpl: typeof fetch
  private readonly maxRetries: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number

  /** このクライアントが Backlog へ投げたリクエスト数。 */
  requestCount = 0
  /** 直近のレスポンスから読み取ったレート制限の状況。 */
  lastRateLimit: BacklogRateLimitEntry | null = null

  constructor(options: BacklogClientOptions) {
    this.space = options.space
    this.accessToken = options.accessToken
    // グローバルの fetch をそのままプロパティに持たせると `this.fetchImpl(...)` の
    // 呼び出しで this がこのインスタンスになり、Workers では Illegal invocation になる。
    // 受け取った実装をそのまま使う場合も含め、必ず globalThis へ束縛しておく。
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis)
    this.maxRetries = options.maxRetries ?? 2
    this.sleep = options.sleep ?? defaultSleep
    this.now = options.now ?? (() => Date.now())
  }

  /** アクセストークンが外部に漏れないようメッセージからマスクする。 */
  private mask(text: string): string {
    if (!this.accessToken) {
      return text
    }
    return text.split(this.accessToken).join('***')
  }

  private buildUrl(path: string, params: QueryParams): string {
    const url = new URL(`https://${this.space}/api/v2${path}`)
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined || value === '') {
        continue
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, String(item))
        }
        continue
      }
      url.searchParams.append(key, String(value))
    }
    return url.toString()
  }

  private readRateLimit(response: Response): void {
    const limit = Number(response.headers.get('X-RateLimit-Limit'))
    const remaining = Number(response.headers.get('X-RateLimit-Remaining'))
    const reset = Number(response.headers.get('X-RateLimit-Reset'))
    if (Number.isFinite(limit) && Number.isFinite(remaining) && Number.isFinite(reset)) {
      this.lastRateLimit = { limit, remaining, reset }
    }
  }

  /** 429 を受けたときに待つべきミリ秒。待つ価値がなければ null。 */
  private retryWaitMs(response: Response, attempt: number): number | null {
    const retryAfter = Number(response.headers.get('Retry-After'))
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      const ms = retryAfter * 1000
      return ms <= MAX_RETRY_WAIT_MS ? ms : null
    }
    const reset = Number(response.headers.get('X-RateLimit-Reset'))
    if (Number.isFinite(reset) && reset > 0) {
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
   * 画像などのバイナリを取得する。レスポンスをそのまま返す。
   *
   * リトライやレート制限の扱いは `get` と同じにしたいが、JSON を前提に
   * しないため別メソッドにしている。
   */
  async getBinary(path: string, params: QueryParams = {}): Promise<Response> {
    return this.request(path, params, 'image/*')
  }

  async get<T>(path: string, params: QueryParams = {}): Promise<T> {
    const response = await this.request(path, params, 'application/json')
    return (await response.json()) as T
  }

  private async request(path: string, params: QueryParams, accept: string): Promise<Response> {
    const url = this.buildUrl(path, params)

    for (let attempt = 0; ; attempt += 1) {
      this.requestCount += 1
      let response: Response
      try {
        response = await this.fetchImpl(url, {
          headers: {
            Accept: accept,
            Authorization: `Bearer ${this.accessToken}`
          }
        })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        throw new BacklogApiError(502, 'Backlog への接続に失敗しました', this.mask(message))
      }

      this.readRateLimit(response)

      if (response.ok) {
        return response
      }

      const shouldRetry = response.status === 429 || response.status >= 500
      if (shouldRetry && attempt < this.maxRetries) {
        const wait = response.status === 429 ? this.retryWaitMs(response, attempt) : 500 * 2 ** attempt
        if (wait !== null) {
          await this.sleep(wait)
          continue
        }
      }

      const body = await response.text().catch(() => '')
      throw new BacklogApiError(response.status, describeStatus(response.status), this.mask(body.slice(0, 500)))
    }
  }
}

function describeStatus(status: number): string {
  switch (status) {
    case 400:
      return 'Backlog へのリクエストが不正です'
    case 401:
      return 'Backlog の認証が切れています。ログインし直してください'
    case 403:
      return 'この操作を行う権限がありません'
    case 404:
      return '指定されたリソースが見つかりません'
    case 429:
      return 'Backlog のレート制限に達しました。しばらく待ってから再読込してください'
    default:
      return status >= 500 ? 'Backlog 側でエラーが発生しました' : 'Backlog API の呼び出しに失敗しました'
  }
}

/**
 * 同時実行数を制限しながら配列を並列処理する。
 *
 * Backlog の Search 区分レート制限（既定で 1 分あたり 150 リクエスト程度）を
 * 使い切らないよう、課題取得の並列度を抑えるために使う。
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = Array.from({ length: items.length }) as R[]
  let cursor = 0

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) {
        return
      }
      results[index] = await fn(items[index], index)
    }
  })

  await Promise.all(workers)
  return results
}
