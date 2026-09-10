/**
 * Worker のバインディングと OAuth 設定の解決。
 */

import type { OAuthConfig } from './oauth'

/** Backlog に登録するリダイレクト URI のパス。 */
export const CALLBACK_PATH = '/api/auth/callback'

/**
 * Worker が受け取るバインディング。
 *
 * `CloudflareBindings` は `wrangler types` が生成する型で、KV バインディングを含む。
 * クライアント ID とシークレットはシークレットとして設定するため、
 * 生成型には現れないことがある。ここで明示的に足しておく。
 */
export type AppBindings = CloudflareBindings & {
  SESSIONS: KVNamespace
  BACKLOG_CLIENT_ID?: string
  BACKLOG_CLIENT_SECRET?: string
  /** 明示的に固定したい場合のみ設定する。未設定ならリクエストのオリジンから導出する。 */
  OAUTH_REDIRECT_URI?: string
}

/** https 経由のリクエストかどうか。ローカル開発（http）では Secure Cookie を付けない。 */
export function isSecureRequest(requestUrl: string): boolean {
  return new URL(requestUrl).protocol === 'https:'
}

/** リクエストのオリジンからコールバック URL を導出する。 */
export function defaultRedirectUri(requestUrl: string): string {
  return new URL(CALLBACK_PATH, new URL(requestUrl).origin).toString()
}

/**
 * OAuth の設定を解決する。クライアント ID かシークレットが未設定なら null。
 *
 * リダイレクト URI は Backlog に登録したものと完全一致している必要がある。
 * 本番とローカルで別々のアプリを登録する運用を想定し、既定ではリクエストの
 * オリジンから導出する。
 */
export function resolveOAuthConfig(env: AppBindings, requestUrl: string): OAuthConfig | null {
  const clientId = env.BACKLOG_CLIENT_ID
  const clientSecret = env.BACKLOG_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return null
  }
  return {
    clientId,
    clientSecret,
    redirectUri: env.OAUTH_REDIRECT_URI ?? defaultRedirectUri(requestUrl)
  }
}
