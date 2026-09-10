/**
 * サーバー側テスト用の補助。実装からは参照されない。
 */

import { putSession, randomId, type SessionRecord } from './auth/session'

type StoredValue = {
  value: string
  /** epoch ミリ秒。未設定なら無期限。 */
  expiresAt: number | null
}

/**
 * KVNamespace の最小限のインメモリ実装。
 *
 * 本アプリが使うのは get / put / delete と expirationTtl だけなので、
 * それ以外のメソッドは未実装のまま型を満たしている。
 */
export function createMemoryKV(now: () => number = () => Date.now()): KVNamespace {
  const store = new Map<string, StoredValue>()

  const read = (key: string): string | null => {
    const entry = store.get(key)
    if (!entry) {
      return null
    }
    if (entry.expiresAt !== null && entry.expiresAt <= now()) {
      store.delete(key)
      return null
    }
    return entry.value
  }

  const kv = {
    get: async (key: string, type?: unknown) => {
      const raw = read(key)
      if (raw === null) {
        return null
      }
      const asType = typeof type === 'string' ? type : (type as { type?: string } | undefined)?.type
      return asType === 'json' ? JSON.parse(raw) : raw
    },
    put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
      const ttl = options?.expirationTtl
      store.set(key, { value, expiresAt: ttl === undefined ? null : now() + ttl * 1000 })
    },
    delete: async (key: string) => {
      store.delete(key)
    },
    list: async () => ({ keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null })
  }

  return kv as unknown as KVNamespace
}

export const TEST_SESSION: SessionRecord = {
  space: 'example.backlog.jp',
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  // 十分に先の日時にして、テスト中にリフレッシュが走らないようにする。
  expiresAt: Date.now() + 60 * 60 * 1000,
  userId: 42,
  userName: '山田太郎'
}

/** セッションを 1 つ作り、Cookie ヘッダーの値を返す。 */
export async function seedSession(
  kv: KVNamespace,
  overrides: Partial<SessionRecord> = {}
): Promise<{ sessionId: string; cookie: string }> {
  const sessionId = randomId(8)
  await putSession(kv, sessionId, { ...TEST_SESSION, ...overrides })
  return { sessionId, cookie: `cg_session=${sessionId}` }
}

/** JSON を返すレスポンスを組み立てる。 */
export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init
  })
}
