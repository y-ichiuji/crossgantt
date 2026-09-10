import { afterEach, describe, expect, it, vi } from 'vitest'

import { hashKey, matchCachedResponse, putCachedResponse, withJsonCache } from './cache'

type CacheEntry = { response: Response }

/** Cloudflare の `caches.default` を模したインメモリ実装。 */
function installMemoryCache() {
  const store = new Map<string, CacheEntry>()
  const cache = {
    match: async (request: Request) => store.get(request.url)?.response.clone() ?? undefined,
    put: async (request: Request, response: Response) => {
      store.set(request.url, { response: response.clone() })
    }
  }
  const original = (globalThis as { caches?: unknown }).caches
  ;(globalThis as { caches?: unknown }).caches = { default: cache }
  return {
    store,
    restore: () => {
      ;(globalThis as { caches?: unknown }).caches = original
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('putCachedResponse / matchCachedResponse', () => {
  it('利用者向けの Cache-Control をヒット時にも保つ', async () => {
    const memory = installMemoryCache()
    try {
      // アイコンはセッションに紐づくため共有キャッシュへ載せてはいけない。
      // 保存時に内部 TTL で上書きしてしまうと、ヒット時にこの指示が消える。
      const original = new Response('image-bytes', {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' }
      })
      await putCachedResponse('icon-key', original, 3600)

      const hit = await matchCachedResponse('icon-key')
      expect(hit).not.toBeNull()
      expect(hit?.headers.get('Cache-Control')).toBe('private, max-age=3600')
      expect(hit?.headers.get('Content-Type')).toBe('image/png')
      // 退避用のヘッダーは外へ出さない。
      expect(hit?.headers.get('x-cg-client-cache-control')).toBeNull()
    } finally {
      memory.restore()
    }
  })

  it('Cache-Control が無いレスポンスはそのまま返す', async () => {
    const memory = installMemoryCache()
    try {
      await putCachedResponse('plain', new Response('x', { headers: { 'Content-Type': 'text/plain' } }), 60)
      const hit = await matchCachedResponse('plain')
      expect(await hit?.text()).toBe('x')
    } finally {
      memory.restore()
    }
  })
})

describe('hashKey', () => {
  it('同じ入力からは同じハッシュになる', async () => {
    expect(await hashKey('a', 'b')).toBe(await hashKey('a', 'b'))
  })

  it('入力が違えばハッシュも変わる', async () => {
    expect(await hashKey('a', 'b')).not.toBe(await hashKey('a', 'c'))
  })

  it('区切りが異なるだけの入力を区別する', async () => {
    expect(await hashKey('ab', 'c')).not.toBe(await hashKey('a', 'bc'))
  })

  it('SHA-256 の 16 進表現を返す', async () => {
    expect(await hashKey('x')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('withJsonCache', () => {
  it('キャッシュが使えない環境では毎回 produce を呼ぶ', async () => {
    const original = (globalThis as { caches?: unknown }).caches
    ;(globalThis as { caches?: unknown }).caches = undefined
    try {
      const produce = vi.fn(async () => ({ value: 1 }))
      expect(await withJsonCache('ns', ['k'], 60, false, produce)).toEqual({ value: 1 })
      expect(await withJsonCache('ns', ['k'], 60, false, produce)).toEqual({ value: 1 })
      expect(produce).toHaveBeenCalledTimes(2)
    } finally {
      ;(globalThis as { caches?: unknown }).caches = original
    }
  })

  it('2 回目はキャッシュから返す', async () => {
    const memory = installMemoryCache()
    try {
      const produce = vi.fn(async () => ({ value: 1 }))
      await withJsonCache('ns', ['k'], 60, false, produce)
      const second = await withJsonCache('ns', ['k'], 60, false, produce)

      expect(second).toEqual({ value: 1 })
      expect(produce).toHaveBeenCalledTimes(1)
    } finally {
      memory.restore()
    }
  })

  it('キーが違えば別のエントリになる', async () => {
    const memory = installMemoryCache()
    try {
      const produce = vi.fn(async () => ({ value: 1 }))
      await withJsonCache('ns', ['a'], 60, false, produce)
      await withJsonCache('ns', ['b'], 60, false, produce)
      expect(produce).toHaveBeenCalledTimes(2)
    } finally {
      memory.restore()
    }
  })

  it('名前空間が違えば別のエントリになる', async () => {
    const memory = installMemoryCache()
    try {
      const produce = vi.fn(async () => ({ value: 1 }))
      await withJsonCache('one', ['k'], 60, false, produce)
      await withJsonCache('two', ['k'], 60, false, produce)
      expect(produce).toHaveBeenCalledTimes(2)
    } finally {
      memory.restore()
    }
  })

  it('bypass が true なら既存のキャッシュを無視して取り直す', async () => {
    const memory = installMemoryCache()
    try {
      let counter = 0
      const produce = vi.fn(async () => ({ value: ++counter }))
      await withJsonCache('ns', ['k'], 60, false, produce)
      const refreshed = await withJsonCache('ns', ['k'], 60, true, produce)

      expect(refreshed).toEqual({ value: 2 })
      expect(produce).toHaveBeenCalledTimes(2)
    } finally {
      memory.restore()
    }
  })

  it('bypass 後の結果でキャッシュが上書きされる', async () => {
    const memory = installMemoryCache()
    try {
      let counter = 0
      const produce = vi.fn(async () => ({ value: ++counter }))
      await withJsonCache('ns', ['k'], 60, false, produce)
      await withJsonCache('ns', ['k'], 60, true, produce)
      const cached = await withJsonCache('ns', ['k'], 60, false, produce)

      expect(cached).toEqual({ value: 2 })
      expect(produce).toHaveBeenCalledTimes(2)
    } finally {
      memory.restore()
    }
  })

  it('キャッシュキーに秘密情報をそのまま載せない', async () => {
    const memory = installMemoryCache()
    try {
      await withJsonCache('ns', ['secret-token'], 60, false, async () => ({ value: 1 }))
      const urls = [...memory.store.keys()]
      expect(urls).toHaveLength(1)
      expect(urls[0]).not.toContain('secret-token')
    } finally {
      memory.restore()
    }
  })
})
