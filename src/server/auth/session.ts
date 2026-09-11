/**
 * セッションと OAuth の nonce を、利用者ごとの永続領域へ保存する。
 *
 * Cloudflare Workers 版では Cookie でセッション ID を渡し、その ID で KV を
 * 引いていた。Apps Script の Web アプリは Google のログインを前提に
 * 「アクセスしているユーザーとして実行」できるため、セッション ID を
 * ブラウザへ渡す必要がない。`PropertiesService.getUserProperties()` は
 * その Google アカウント専用の領域なので、アクセストークンはそこへ置く。
 *
 * 置くのは有効期限付きのトークンだけに留める。
 */

/** 利用者ごとの永続領域。Apps Script では UserProperties に対応する。 */
export type UserStore = {
  get: (key: string) => string | null
  put: (key: string, value: string) => void
  remove: (key: string) => void
}

/** セッションを入れるキー。 */
const SESSION_KEY = 'session'

/** 認可フローの nonce を入れるキー。 */
const NONCE_KEY = 'oauthNonces'

/** セッションの有効期間（秒）。リフレッシュトークンの寿命に合わせて長めに取る。 */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

/** 認可フローの nonce の有効期間（秒）。 */
export const NONCE_TTL_SECONDS = 10 * 60

/**
 * 同時に有効にしておく nonce の数。
 *
 * 画面を複数のタブで開くとタブごとに nonce が発行される。1 つしか覚えないと、
 * 後から開いたタブが前のタブの nonce を上書きし、先に開いたタブからの
 * ログインが必ず失敗する。
 */
export const MAX_PENDING_NONCES = 5

export type SessionRecord = {
  space: string
  accessToken: string
  refreshToken: string
  /** アクセストークンの期限（epoch ミリ秒）。 */
  expiresAt: number
  userId: number
  userName: string
  /** セッション自体の期限（epoch ミリ秒）。 */
  sessionExpiresAt: number
}

/** 保存前のセッション。期限はここで付ける。 */
export type NewSession = Omit<SessionRecord, 'sessionExpiresAt'>

type PendingNonce = {
  nonce: string
  /** epoch ミリ秒。 */
  expiresAt: number
}

function isSessionRecord(value: unknown): value is SessionRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.space === 'string' &&
    typeof candidate.accessToken === 'string' &&
    typeof candidate.refreshToken === 'string' &&
    typeof candidate.expiresAt === 'number' &&
    typeof candidate.userId === 'number' &&
    typeof candidate.userName === 'string' &&
    typeof candidate.sessionExpiresAt === 'number'
  )
}

function parseJson(raw: string | null): unknown {
  if (raw === null) {
    return null
  }
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** 保存済みのセッション。無い場合や期限切れの場合は null。 */
export function readSession(store: UserStore, now: number): SessionRecord | null {
  const parsed = parseJson(store.get(SESSION_KEY))
  if (!isSessionRecord(parsed)) {
    return null
  }
  if (parsed.sessionExpiresAt <= now) {
    store.remove(SESSION_KEY)
    return null
  }
  return parsed
}

/** セッションを保存する。保存のたびに期限を延ばす。 */
export function writeSession(store: UserStore, session: NewSession, now: number): SessionRecord {
  const record: SessionRecord = { ...session, sessionExpiresAt: now + SESSION_TTL_SECONDS * 1000 }
  store.put(SESSION_KEY, JSON.stringify(record))
  return record
}

/** セッションを破棄する。 */
export function clearSession(store: UserStore): void {
  store.remove(SESSION_KEY)
}

function readNonces(store: UserStore, now: number): PendingNonce[] {
  const parsed = parseJson(store.get(NONCE_KEY))
  if (!Array.isArray(parsed)) {
    return []
  }
  return parsed.filter(
    (entry: unknown): entry is PendingNonce =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as PendingNonce).nonce === 'string' &&
      typeof (entry as PendingNonce).expiresAt === 'number' &&
      (entry as PendingNonce).expiresAt > now
  )
}

function writeNonces(store: UserStore, nonces: PendingNonce[]): void {
  if (nonces.length === 0) {
    store.remove(NONCE_KEY)
    return
  }
  store.put(NONCE_KEY, JSON.stringify(nonces))
}

/** 認可フロー用の nonce を払い出して覚える。 */
export function issueNonce(store: UserStore, nonce: string, now: number): void {
  const pending = readNonces(store, now)
  pending.push({ nonce, expiresAt: now + NONCE_TTL_SECONDS * 1000 })
  // 古いものから捨てる。
  writeNonces(store, pending.slice(-MAX_PENDING_NONCES))
}

/**
 * nonce を照合し、同時に消費する。
 *
 * 一度使った nonce を残すと、認可コードの再送（ブラウザの戻る・再読込）を
 * そのまま受け付けてしまう。
 */
export function consumeNonce(store: UserStore, nonce: string, now: number): boolean {
  const pending = readNonces(store, now)
  const remaining = pending.filter((entry) => entry.nonce !== nonce)
  if (remaining.length === pending.length) {
    return false
  }
  writeNonces(store, remaining)
  return true
}
