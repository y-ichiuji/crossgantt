/**
 * サーバー側テスト用の補助。実装からは参照されない。
 *
 * Apps Script のサービスは `src/server/gas/` でしか触らないため、
 * ここではその抽象（Fetcher / CacheStore / UserStore）だけを
 * インメモリで用意する。
 */

import { createHash } from 'node:crypto'

import type { ApiContext } from './api'
import type { OAuthConfig } from './auth/oauth'
import type { UserStore } from './auth/session'
import { createJsonCache } from './cache'
import type { CacheStore, JsonCache } from './cache'
import type { Fetcher, FetchRequest, FetchResponse } from './fetcher'

/** テストの基準時刻（epoch ミリ秒）。 */
export const TEST_NOW = Date.parse('2026-09-11T00:00:00Z')

/** Node の crypto で SHA-256 の 16 進表現を作る。Apps Script 版の代わり。 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/** 任意の本文を返す応答。 */
export function textResponse(status: number, body: string, headers: Record<string, string> = {}): FetchResponse {
  const lowered: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    lowered[name.toLowerCase()] = value
  }
  return {
    status,
    header: (name) => lowered[name.toLowerCase()] ?? null,
    text: () => body,
    base64: () => Buffer.from(body, 'utf8').toString('base64')
  }
}

/** JSON を返す応答。 */
export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): FetchResponse {
  return textResponse(status, JSON.stringify(body), { 'Content-Type': 'application/json', ...headers })
}

export type FetcherStub = {
  fetcher: Fetcher
  /** 投げられたリクエストを投げた順に記録する。 */
  requests: FetchRequest[]
  /** `fetcher` が呼ばれた回数（= まとめて投げた回数）。 */
  batches: FetchRequest[][]
}

/**
 * 決まった応答を返す Fetcher。
 *
 * `respond` にはリクエストと通し番号が渡る。通し番号はテスト全体での順番で、
 * まとめて投げられた分もそれぞれ 1 つとして数える。
 */
export function createFetcherStub(respond: (request: FetchRequest, index: number) => FetchResponse): FetcherStub {
  const requests: FetchRequest[] = []
  const batches: FetchRequest[][] = []
  return {
    requests,
    batches,
    fetcher: (batch) => {
      batches.push(batch)
      return batch.map((request) => {
        const index = requests.length
        requests.push(request)
        return respond(request, index)
      })
    }
  }
}

export type MemoryCacheStore = CacheStore & {
  /** 保存されているキー。キャッシュキーの検証に使う。 */
  keys: () => string[]
  /** すべて捨てる。 */
  clear: () => void
}

/** インメモリの CacheStore。TTL も模す。 */
export function createMemoryCacheStore(now: () => number = () => TEST_NOW): MemoryCacheStore {
  const store = new Map<string, { value: string; expiresAt: number }>()

  const read = (key: string): string | null => {
    const entry = store.get(key)
    if (!entry) {
      return null
    }
    if (entry.expiresAt <= now()) {
      store.delete(key)
      return null
    }
    return entry.value
  }

  return {
    get: read,
    getAll: (keys) => {
      const found: Record<string, string | undefined> = {}
      for (const key of keys) {
        const value = read(key)
        if (value !== null) {
          found[key] = value
        }
      }
      return found
    },
    putAll: (values, ttlSeconds) => {
      for (const [key, value] of Object.entries(values)) {
        store.set(key, { value, expiresAt: now() + ttlSeconds * 1000 })
      }
    },
    keys: () => [...store.keys()],
    clear: () => {
      store.clear()
    }
  }
}

/** インメモリの JsonCache。 */
export function createMemoryJsonCache(now?: () => number): JsonCache {
  return createJsonCache(createMemoryCacheStore(now), sha256Hex)
}

export type MemoryUserStore = UserStore & {
  /** 保存されている内容。 */
  snapshot: () => Record<string, string>
}

/** インメモリの UserStore。Apps Script の UserProperties の代わり。 */
export function createMemoryUserStore(initial: Record<string, string> = {}): MemoryUserStore {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    get: (key) => store.get(key) ?? null,
    put: (key, value) => {
      store.set(key, value)
    },
    remove: (key) => {
      store.delete(key)
    },
    snapshot: () => Object.fromEntries(store)
  }
}

/** テストで使う OAuth 設定。 */
export const TEST_OAUTH: OAuthConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://script.google.com/macros/s/deployment-id/exec'
}

export type TestApiContext = ApiContext & {
  store: MemoryUserStore
  /** `log` に渡された内容。 */
  logs: string[]
}

/** API の実行文脈をインメモリで組み立てる。 */
export function createTestApiContext(
  options: {
    fetcher?: Fetcher
    now?: () => number
    oauth?: OAuthConfig | null
    store?: MemoryUserStore
    cache?: JsonCache
    sharedCache?: JsonCache
  } = {}
): TestApiContext {
  const now = options.now ?? (() => TEST_NOW)
  const logs: string[] = []
  return {
    now,
    store: options.store ?? createMemoryUserStore(),
    cache: options.cache ?? createMemoryJsonCache(now),
    sharedCache: options.sharedCache ?? createMemoryJsonCache(now),
    fetcher:
      options.fetcher ??
      (() => {
        throw new Error('fetcher が呼ばれました')
      }),
    sleep: () => {
      // テストでは待たない。
    },
    oauth: options.oauth === undefined ? TEST_OAUTH : options.oauth,
    withLock: (produce) => produce(),
    log: (message) => {
      logs.push(message)
    },
    logs
  }
}
