/**
 * セッションと OAuth の state を Workers KV に保存する。
 *
 * ブラウザには HttpOnly Cookie でセッション ID だけを渡し、
 * アクセストークンとリフレッシュトークンはサーバー側にのみ置く。
 */

/** セッション ID を入れる Cookie 名。 */
export const SESSION_COOKIE = 'cg_session'

/** OAuth の state を入れる Cookie 名（KV の値との二重照合に使う）。 */
export const STATE_COOKIE = 'cg_oauth_state'

/** セッションの有効期間（秒）。リフレッシュトークンの寿命に合わせて長めに取る。 */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

/** 認可フローの state の有効期間（秒）。 */
export const STATE_TTL_SECONDS = 10 * 60

const SESSION_PREFIX = 'session:'
const STATE_PREFIX = 'oauth_state:'

export type SessionRecord = {
  space: string
  accessToken: string
  refreshToken: string
  /** epoch ミリ秒。 */
  expiresAt: number
  userId: number
  userName: string
}

export type StateRecord = {
  space: string
  /** 認可後に戻す先のパス（オープンリダイレクトを避けるため相対パスのみ）。 */
  returnTo: string
}

/** 推測不能なランダム ID を生成する。 */
export function randomId(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function putSession(kv: KVNamespace, id: string, record: SessionRecord): Promise<void> {
  await kv.put(SESSION_PREFIX + id, JSON.stringify(record), { expirationTtl: SESSION_TTL_SECONDS })
}

export async function getSession(kv: KVNamespace, id: string): Promise<SessionRecord | null> {
  return kv.get<SessionRecord>(SESSION_PREFIX + id, 'json')
}

export async function deleteSession(kv: KVNamespace, id: string): Promise<void> {
  await kv.delete(SESSION_PREFIX + id)
}

export async function putState(kv: KVNamespace, state: string, record: StateRecord): Promise<void> {
  await kv.put(STATE_PREFIX + state, JSON.stringify(record), { expirationTtl: STATE_TTL_SECONDS })
}

/** state を取り出し、同時に消費する（再利用を防ぐため）。 */
export async function takeState(kv: KVNamespace, state: string): Promise<StateRecord | null> {
  const key = STATE_PREFIX + state
  const record = await kv.get<StateRecord>(key, 'json')
  if (record) {
    await kv.delete(key)
  }
  return record
}

/**
 * 認可後の戻り先として安全なパスだけを許可する。
 *
 * `//evil.example.com` のようなプロトコル相対 URL を弾かないと
 * オープンリダイレクトになるため、先頭が `/` かつ 2 文字目が `/` でないものに限る。
 */
export function sanitizeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/'
  }
  return value
}

export type CookieOptions = {
  maxAge?: number
  /** ローカル開発（http）では Secure を外す必要がある。 */
  secure: boolean
}

/** Set-Cookie ヘッダーの値を組み立てる。 */
export function buildCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax']
  if (options.secure) {
    parts.push('Secure')
  }
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`)
  }
  return parts.join('; ')
}

/** Cookie を削除するための Set-Cookie 値。 */
export function buildClearCookie(name: string, secure: boolean): string {
  return buildCookie(name, '', { maxAge: 0, secure })
}

/** Cookie ヘッダーから 1 つの値を取り出す。 */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) {
    return null
  }
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) {
      continue
    }
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim()
    }
  }
  return null
}
