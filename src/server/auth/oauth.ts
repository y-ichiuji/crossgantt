/**
 * Backlog の OAuth 2.0 トークンエンドポイントとのやり取り。
 *
 * Backlog の認可・トークンエンドポイントはスペースごとに存在するため、
 * どのスペースへ認可を求めたかを `state` に載せて持ち回る（`shared/oauth.ts`）。
 *
 * @see https://developer.nulab.com/docs/backlog/auth/
 */

import { TOKEN_PATH } from '../../shared/oauth'
import { encodeQuery } from '../fetcher'
import type { Fetcher, QueryParams } from '../fetcher'

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

function requestToken(space: string, payload: QueryParams, now: number, fetcher: Fetcher): TokenSet {
  let status: number
  let body: string
  try {
    const [response] = fetcher([
      {
        url: `https://${space}${TOKEN_PATH}`,
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        headers: { Accept: 'application/json' },
        payload: encodeQuery(payload)
      }
    ])
    status = response.status
    body = response.text()
  } catch {
    throw new OAuthError(502, 'Backlog の認可サーバーへ接続できませんでした')
  }

  if (status < 200 || status >= 300) {
    throw new OAuthError(
      status === 400 || status === 401 ? 401 : 502,
      'Backlog からアクセストークンを取得できませんでした'
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new OAuthError(502, 'Backlog のトークンレスポンスを解釈できませんでした')
  }
  if (!isTokenResponse(parsed)) {
    throw new OAuthError(502, 'Backlog のトークンレスポンスを解釈できませんでした')
  }

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresAt: now + parsed.expires_in * 1000
  }
}

/** 認可コードをアクセストークンに交換する。 */
export function exchangeCode(
  space: string,
  config: OAuthConfig,
  code: string,
  now: number,
  fetcher: Fetcher
): TokenSet {
  return requestToken(
    space,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret
    },
    now,
    fetcher
  )
}

/** リフレッシュトークンでアクセストークンを更新する。 */
export function refreshTokens(
  space: string,
  config: OAuthConfig,
  refreshToken: string,
  now: number,
  fetcher: Fetcher
): TokenSet {
  const tokens = requestToken(
    space,
    {
      grant_type: 'refresh_token',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken
    },
    now,
    fetcher
  )
  // Backlog はリフレッシュトークンを返さない場合があるため、その際は元の値を引き継ぐ。
  return { ...tokens, refreshToken: tokens.refreshToken || refreshToken }
}

/** アクセストークンが失効間近かどうか。 */
export function needsRefresh(expiresAt: number, now: number): boolean {
  return expiresAt - now <= TOKEN_REFRESH_MARGIN_MS
}
