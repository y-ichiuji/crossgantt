/**
 * Backlog の OAuth 2.0 クライアント。
 *
 * Backlog の認可エンドポイントはスペースごとに存在するため、
 * どのスペースへ認可を求めるかを state に紐づけて持ち回る必要がある。
 *
 * @see https://developer.nulab.com/docs/backlog/auth/
 */

/** 認可リクエストを送るパス（スペースのホスト直下）。 */
const AUTHORIZE_PATH = '/OAuth2AccessRequest.action'

/** アクセストークンの発行・更新を行うパス。 */
const TOKEN_PATH = '/api/v2/oauth2/token'

/**
 * アクセストークンを期限切れとみなす前倒し時間（ミリ秒）。
 *
 * 実際の期限ぎりぎりまで使うと、リクエスト中に切れて 401 になるため余裕を持たせる。
 */
export const TOKEN_REFRESH_MARGIN_MS = 60_000

export type OAuthConfig = {
  clientId: string
  clientSecret: string
  /** Backlog に登録したものと完全に一致する必要がある。 */
  redirectUri: string
}

export type TokenSet = {
  accessToken: string
  refreshToken: string
  /** epoch ミリ秒。 */
  expiresAt: number
}

/** Backlog のトークンエンドポイントが返す JSON。 */
type TokenResponse = {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token: string
}

export class OAuthError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'OAuthError'
    this.status = status
  }
}

/** 認可画面の URL を組み立てる。 */
export function buildAuthorizeUrl(space: string, config: OAuthConfig, state: string): string {
  const url = new URL(AUTHORIZE_PATH, `https://${space}`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('state', state)
  return url.toString()
}

function isTokenResponse(value: unknown): value is TokenResponse {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.access_token === 'string' &&
    typeof candidate.refresh_token === 'string' &&
    typeof candidate.expires_in === 'number'
  )
}

async function requestToken(
  space: string,
  body: URLSearchParams,
  now: number,
  fetchImpl: typeof fetch
): Promise<TokenSet> {
  const url = new URL(TOKEN_PATH, `https://${space}`)

  let response: Response
  try {
    response = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: body.toString()
    })
  } catch {
    throw new OAuthError(502, 'Backlog の認可サーバーへ接続できませんでした')
  }

  if (!response.ok) {
    throw new OAuthError(
      response.status === 400 || response.status === 401 ? 401 : 502,
      'Backlog からアクセストークンを取得できませんでした'
    )
  }

  const payload: unknown = await response.json().catch(() => null)
  if (!isTokenResponse(payload)) {
    throw new OAuthError(502, 'Backlog のトークンレスポンスを解釈できませんでした')
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: now + payload.expires_in * 1000
  }
}

/** 認可コードをアクセストークンに交換する。 */
export async function exchangeCode(
  space: string,
  config: OAuthConfig,
  code: string,
  now: number,
  fetchImpl: typeof fetch = fetch.bind(globalThis)
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret
  })
  return requestToken(space, body, now, fetchImpl)
}

/** リフレッシュトークンでアクセストークンを更新する。 */
export async function refreshTokens(
  space: string,
  config: OAuthConfig,
  refreshToken: string,
  now: number,
  fetchImpl: typeof fetch = fetch.bind(globalThis)
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken
  })
  const tokens = await requestToken(space, body, now, fetchImpl)
  // Backlog はリフレッシュトークンを返さない場合があるため、その際は元の値を引き継ぐ。
  return { ...tokens, refreshToken: tokens.refreshToken || refreshToken }
}

/** アクセストークンが失効間近かどうか。 */
export function needsRefresh(expiresAt: number, now: number): boolean {
  return expiresAt - now <= TOKEN_REFRESH_MARGIN_MS
}
