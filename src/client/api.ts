/**
 * Apps Script 上のサーバー処理を呼び出すクライアント。
 *
 * Web アプリの画面はサンドボックス iframe の中で動き、同じオリジンに
 * API のエンドポイントは存在しない。サーバーとのやり取りはすべて
 * `google.script.run` を通す。
 *
 * 認証は Google のログインに紐づくため、アクセストークンはブラウザ側に
 * 一切渡らない（サーバーの UserProperties にのみ置かれる）。
 */

import { buildAuthorizeUrl, encodeState } from '../shared/oauth'
import { normalizeSpace } from '../shared/space'
import type {
  ApiEnvelope,
  Holiday,
  IssuesQuery,
  IssuesResponse,
  MemberSummary,
  ProjectSummary,
  StatusGroup,
  Viewer
} from '../shared/types'
import { loadBootstrap } from './bootstrap'

/** サーバーへ渡すパラメータ。クエリ文字列と同じく文字列だけで表す。 */
type ApiParams = Record<string, string>

/**
 * `google.script.run` の形。
 *
 * `withSuccessHandler` などは新しいランナーを返すため、呼び出しは連鎖できる。
 */
type ScriptRunner = {
  withSuccessHandler: (handler: (value: string) => void) => ScriptRunner
  withFailureHandler: (handler: (error: Error) => void) => ScriptRunner
  apiCall: (name: string, paramsJson: string) => void
}

type ScriptCarrier = {
  google?: { script?: { run?: ScriptRunner } }
}

export class ApiError extends Error {
  readonly status: number
  readonly detail: string | undefined

  constructor(status: number, message: string, detail?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }

  /** 未ログイン、またはセッション切れ。 */
  get isUnauthorized(): boolean {
    return this.status === 401
  }
}

function scriptRunner(): ScriptRunner | null {
  if (typeof window === 'undefined') {
    return null
  }
  return (window as unknown as ScriptCarrier).google?.script?.run ?? null
}

/** Apps Script のウェブアプリとして開かれているかどうか。 */
export function isServerAvailable(): boolean {
  return scriptRunner() !== null
}

function abortError(): DOMException {
  return new DOMException('中断されました', 'AbortError')
}

function isEnvelope(value: unknown): value is ApiEnvelope {
  return typeof value === 'object' && value !== null && typeof (value as { ok?: unknown }).ok === 'boolean'
}

/**
 * サーバーの関数を 1 回呼ぶ。
 *
 * `google.script.run` は中断できないため、`signal` が中断された場合は
 * 応答を捨てて AbortError を投げる。呼び出し自体はそのまま完了する。
 */
function call<T>(name: string, params: ApiParams, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const runner = scriptRunner()
    if (!runner) {
      reject(
        new ApiError(
          503,
          'サーバーへ接続できません',
          'この画面は Google Apps Script のウェブアプリとして開く必要があります'
        )
      )
      return
    }
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    let settled = false
    const onAbort = () => {
      if (settled) {
        return
      }
      settled = true
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const finish = (act: () => void) => {
      if (settled) {
        return
      }
      settled = true
      signal?.removeEventListener('abort', onAbort)
      act()
    }

    runner
      .withSuccessHandler((raw) => {
        finish(() => {
          let parsed: unknown
          try {
            parsed = JSON.parse(raw)
          } catch {
            reject(new ApiError(502, 'サーバーの応答を解釈できませんでした'))
            return
          }
          if (!isEnvelope(parsed)) {
            reject(new ApiError(502, 'サーバーの応答を解釈できませんでした'))
            return
          }
          if (!parsed.ok) {
            reject(new ApiError(parsed.status, parsed.error, parsed.detail ?? undefined))
            return
          }
          resolve(parsed.data as T)
        })
      })
      .withFailureHandler((error: Error | undefined) => {
        finish(() => {
          reject(new ApiError(500, error?.message ?? 'サーバーの呼び出しに失敗しました'))
        })
      })
      .apiCall(name, JSON.stringify(params))
  })
}

/** 表示期間内の日本の祝日。 */
export async function getHolidays(from: string, to: string, signal?: AbortSignal): Promise<Holiday[]> {
  return call<Holiday[]>('holidays', { from, to }, signal)
}

/** 現在のセッション情報。未ログインなら ApiError(401) を投げる。 */
export async function getSession(signal?: AbortSignal): Promise<Viewer> {
  return call<Viewer>('session', {}, signal)
}

/**
 * 最上位フレームを遷移させる。
 *
 * Web アプリの画面はサンドボックス iframe の中にあり、Backlog の認可画面は
 * iframe 内に表示できない（`X-Frame-Options`）。`target="_top"` のリンクを
 * クリック操作と同じ流れの中で発火させることでのみ、最上位フレームを
 * 動かすことが許される。
 */
function navigateTop(url: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.target = '_top'
  anchor.rel = 'noreferrer'
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

/**
 * Backlog の認可画面へ遷移する。
 *
 * 認可 URL の組み立てをクライアント側で行うのは、クリックから遷移までを
 * 同期処理で完結させる必要があるため。`state` に載せるスペースと表示条件は
 * サーバー側で検証し直す。
 *
 * @param space 利用者が入力したスペースドメイン
 * @param returnQuery 認可後に復元する表示条件のクエリ文字列
 */
export function startLogin(space: string, returnQuery: string): void {
  const normalized = normalizeSpace(space)
  if (!normalized) {
    throw new ApiError(
      400,
      'Backlog のスペースドメインが正しくありません',
      'example.backlog.jp / example.backlog.com / example.backlogtool.com の形式で指定してください'
    )
  }

  const bootstrap = loadBootstrap()
  if (!bootstrap.configured) {
    throw new ApiError(
      500,
      'このアプリの OAuth 設定が未完了です',
      'スクリプトプロパティに BACKLOG_CLIENT_ID・BACKLOG_CLIENT_SECRET・OAUTH_REDIRECT_URI を設定してください'
    )
  }

  navigateTop(
    buildAuthorizeUrl({
      space: normalized,
      clientId: bootstrap.clientId,
      redirectUri: bootstrap.redirectUri,
      state: encodeState({ nonce: bootstrap.nonce, space: normalized, query: returnQuery })
    })
  )
}

export async function logout(): Promise<void> {
  await call<null>('logout', {})
}

export async function getProjects(refresh: boolean, signal?: AbortSignal): Promise<ProjectSummary[]> {
  return call<ProjectSummary[]>('projects', refresh ? { refresh: '1' } : {}, signal)
}

export async function getMembers(
  projectIds: number[],
  refresh: boolean,
  signal?: AbortSignal
): Promise<MemberSummary[]> {
  const params: ApiParams = { projectIds: projectIds.join(',') }
  if (refresh) {
    params.refresh = '1'
  }
  return call<MemberSummary[]>('members', params, signal)
}

export async function getStatuses(
  projectIds: number[],
  refresh: boolean,
  signal?: AbortSignal
): Promise<StatusGroup[]> {
  const params: ApiParams = { projectIds: projectIds.join(',') }
  if (refresh) {
    params.refresh = '1'
  }
  return call<StatusGroup[]>('statuses', params, signal)
}

export async function getIssues(query: IssuesQuery, refresh: boolean, signal?: AbortSignal): Promise<IssuesResponse> {
  const params: ApiParams = {
    projectIds: query.projectIds.join(','),
    from: query.from,
    to: query.to
  }
  if (query.assigneeIds.length > 0) {
    params.assigneeIds = query.assigneeIds.join(',')
  }
  if (query.statusNames.length > 0) {
    params.statuses = query.statusNames.join(',')
  }
  if (query.keyword) {
    params.keyword = query.keyword
  }
  if (query.includeClosed) {
    params.closed = '1'
  }
  if (query.includeNoDate) {
    params.nodate = '1'
  }
  if (refresh) {
    params.refresh = '1'
  }
  return call<IssuesResponse>('issues', params, signal)
}

/**
 * 担当者のアイコンを data URL でまとめて取得する。
 *
 * 取得できなかった ID は結果に含まれない。
 */
export async function getIcons(userIds: number[]): Promise<Record<string, string>> {
  if (userIds.length === 0) {
    return {}
  }
  return call<Record<string, string>>('icons', { userIds: userIds.join(',') })
}
