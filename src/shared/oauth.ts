/**
 * Backlog OAuth 2.0 のうち、クライアントとサーバーの双方が必要とする定義。
 *
 * Apps Script の Web アプリはサンドボックス iframe の中で動くため、認可画面へは
 * 最上位フレームを遷移させるしかない（iframe 内で開こうとしても Backlog 側の
 * `X-Frame-Options` で拒否される）。最上位フレームの遷移はユーザー操作に
 * 由来していないと許されないので、クリックと同じ同期処理の中でリンクを
 * 組み立てられるよう、認可 URL の生成はクライアント側に置いている。
 *
 * その代わり、認可リクエストの `state` にはサーバーが払い出した nonce に加えて
 * 「どのスペースへ認可を求めたか」と「認可後に復元したい表示条件」も載せる。
 * スペースはクライアント由来の値になるため、サーバー側で受け取ったあとに
 * 必ず `normalizeSpace` を通し直して許可ドメインだけに絞る。
 *
 * @see https://developer.nulab.com/docs/backlog/auth/
 */

import { normalizeSpace } from './space'

/** 認可リクエストを送るパス（スペースのホスト直下）。 */
export const AUTHORIZE_PATH = '/OAuth2AccessRequest.action'

/** アクセストークンの発行・更新を行うパス。 */
export const TOKEN_PATH = '/api/v2/oauth2/token'

/**
 * state に載せる要素の区切り文字。
 *
 * `URLSearchParams.toString()` は `|` を必ず `%7C` へ変換するため、
 * 3 番目の要素（表示条件のクエリ文字列）に生の `|` は現れない。
 */
const STATE_SEPARATOR = '|'

/** nonce として受け付ける形（`randomToken` が作る 16 進文字列）。 */
const NONCE_PATTERN = /^[0-9a-f]{16,128}$/u

/** state に載せる表示条件の長さ上限。長すぎる state は認可サーバーに拒まれうる。 */
export const MAX_STATE_QUERY_LENGTH = 1500

export type StateParts = {
  /** サーバーが払い出した使い捨ての値。 */
  nonce: string
  /** 認可を求める Backlog スペースのドメイン。 */
  space: string
  /** 認可後に復元する表示条件のクエリ文字列（`?` は含まない）。 */
  query: string
}

/**
 * 上限に収まるところまでを、パラメータの区切りで切り出す。
 *
 * 長さだけを見て機械的に切ると `projects=100,200,3` のように値の途中で
 * 切れる。復元側から見ると「妥当だが別の条件」にしか見えないため、
 * 利用者が選んでいないプロジェクトが混ざったまま画面が出てしまう。
 */
function clampQuery(query: string): string {
  if (query.length <= MAX_STATE_QUERY_LENGTH) {
    return query
  }
  const boundary = query.lastIndexOf('&', MAX_STATE_QUERY_LENGTH)
  // 最初のパラメータだけで上限を超える場合は、引き継ぐものが無い。
  return boundary === -1 ? '' : query.slice(0, boundary)
}

/** state の値を組み立てる。 */
export function encodeState(parts: StateParts): string {
  return [parts.nonce, parts.space, clampQuery(parts.query)].join(STATE_SEPARATOR)
}

/**
 * state の値を分解する。形が合わない場合や許可されないスペースの場合は null。
 *
 * nonce の照合（サーバーが払い出したものかどうか）は呼び出し側で行う。
 */
export function decodeState(value: string | null | undefined): StateParts | null {
  if (!value) {
    return null
  }
  const separator = value.indexOf(STATE_SEPARATOR)
  if (separator === -1) {
    return null
  }
  const nonce = value.slice(0, separator)
  if (!NONCE_PATTERN.test(nonce)) {
    return null
  }
  const rest = value.slice(separator + 1)
  const secondSeparator = rest.indexOf(STATE_SEPARATOR)
  const space = normalizeSpace(secondSeparator === -1 ? rest : rest.slice(0, secondSeparator))
  if (!space) {
    return null
  }
  const query = secondSeparator === -1 ? '' : rest.slice(secondSeparator + 1)
  if (query.length > MAX_STATE_QUERY_LENGTH) {
    return null
  }
  return { nonce, space, query }
}

export type AuthorizeUrlParams = {
  space: string
  clientId: string
  /** Backlog に登録したものと完全に一致する必要がある。 */
  redirectUri: string
  state: string
}

/**
 * 認可画面の URL を組み立てる。
 *
 * `URLSearchParams` は Apps Script に存在しないため、サーバー側でも使える
 * `encodeURIComponent` だけで組み立てる。
 */
export function buildAuthorizeUrl(params: AuthorizeUrlParams): string {
  const query = [
    'response_type=code',
    `client_id=${encodeURIComponent(params.clientId)}`,
    `redirect_uri=${encodeURIComponent(params.redirectUri)}`,
    `state=${encodeURIComponent(params.state)}`
  ].join('&')
  return `https://${params.space}${AUTHORIZE_PATH}?${query}`
}
