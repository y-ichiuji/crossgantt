import { describe, expect, it, vi } from 'vitest'

import { createJsonCache, createNullJsonCache } from './cache'
import { createMemoryCacheStore, sha256Hex } from './test-utils'

function createCache() {
  const store = createMemoryCacheStore()
  return { store, cache: createJsonCache(store, sha256Hex) }
}

describe('hashKey', () => {
  const { cache } = createCache()

  it('同じ入力からは同じハッシュになる', () => {
    expect(cache.hashKey('a', 'b')).toBe(cache.hashKey('a', 'b'))
  })

  it('入力が違えばハッシュも変わる', () => {
    expect(cache.hashKey('a', 'b')).not.toBe(cache.hashKey('a', 'c'))
  })

  it('区切りが異なるだけの入力を区別する', () => {
    expect(cache.hashKey('ab', 'c')).not.toBe(cache.hashKey('a', 'bc'))
  })

  it('SHA-256 の 16 進表現を返す', () => {
    expect(cache.hashKey('x')).toMatch(/^[0-9a-f]{64}$/u)
  })
})

describe('withJson', () => {
  it('2 回目はキャッシュから返す', () => {
    const { cache } = createCache()
    const produce = vi.fn(() => ({ value: 1 }))

    cache.withJson('ns', ['k'], 60, false, produce)
    expect(cache.withJson('ns', ['k'], 60, false, produce)).toEqual({ value: 1 })
    expect(produce).toHaveBeenCalledTimes(1)
  })

  it('キーが違えば別のエントリになる', () => {
    const { cache } = createCache()
    const produce = vi.fn(() => ({ value: 1 }))

    cache.withJson('ns', ['a'], 60, false, produce)
    cache.withJson('ns', ['b'], 60, false, produce)
    expect(produce).toHaveBeenCalledTimes(2)
  })

  it('名前空間が違えば別のエントリになる', () => {
    const { cache } = createCache()
    const produce = vi.fn(() => ({ value: 1 }))

    cache.withJson('one', ['k'], 60, false, produce)
    cache.withJson('two', ['k'], 60, false, produce)
    expect(produce).toHaveBeenCalledTimes(2)
  })

  it('bypass が true なら既存のキャッシュを無視して取り直す', () => {
    const { cache } = createCache()
    let counter = 0
    const produce = vi.fn(() => {
      counter += 1
      return { value: counter }
    })

    cache.withJson('ns', ['k'], 60, false, produce)
    expect(cache.withJson('ns', ['k'], 60, true, produce)).toEqual({ value: 2 })
    expect(produce).toHaveBeenCalledTimes(2)
  })

  it('bypass 後の結果でキャッシュが上書きされる', () => {
    const { cache } = createCache()
    let counter = 0
    const produce = vi.fn(() => {
      counter += 1
      return { value: counter }
    })

    cache.withJson('ns', ['k'], 60, false, produce)
    cache.withJson('ns', ['k'], 60, true, produce)
    expect(cache.withJson('ns', ['k'], 60, false, produce)).toEqual({ value: 2 })
    expect(produce).toHaveBeenCalledTimes(2)
  })

  it('キャッシュキーに秘密情報をそのまま載せない', () => {
    const { store, cache } = createCache()

    cache.withJson('ns', ['secret-token'], 60, false, () => ({ value: 1 }))
    for (const key of store.keys()) {
      expect(key).not.toContain('secret-token')
    }
  })

  it('期限を過ぎたら取り直す', () => {
    let now = 1_000_000
    const cache = createJsonCache(
      createMemoryCacheStore(() => now),
      sha256Hex
    )
    const produce = vi.fn(() => ({ value: 1 }))

    cache.withJson('ns', ['k'], 60, false, produce)
    now += 61_000
    cache.withJson('ns', ['k'], 60, false, produce)
    expect(produce).toHaveBeenCalledTimes(2)
  })

  it('100KB を超える値も分割して保存し、そのまま読み戻せる', () => {
    const { store, cache } = createCache()
    // 日本語 1 文字 3 バイトで 1 キーの上限（約 100KB）を確実に超える長さ。
    const big = { text: 'あ'.repeat(50_000) }
    const produce = vi.fn(() => big)

    cache.withJson('ns', ['k'], 60, false, produce)
    expect(cache.withJson('ns', ['k'], 60, false, produce)).toEqual(big)
    expect(produce).toHaveBeenCalledTimes(1)
    // 本体 1 つ + 断片 2 つ以上。
    expect(store.keys().length).toBeGreaterThan(2)
  })

  it('断片が一部欠けていたら取り直す', () => {
    const { store, cache } = createCache()
    const produce = vi.fn(() => ({ text: 'あ'.repeat(50_000) }))

    cache.withJson('ns', ['k'], 60, false, produce)
    // 断片ごとに期限が来るため、一部だけ落ちることがある。
    const chunkKey = store.keys().find((key) => key.endsWith('#1'))
    expect(chunkKey).toBeDefined()
    store.putAll({ [chunkKey ?? '']: '' }, -1)

    cache.withJson('ns', ['k'], 60, false, produce)
    expect(produce).toHaveBeenCalledTimes(2)
  })

  it('断片数の上限を超える値は保存しない', () => {
    const { cache } = createCache()
    // 断片は 30,000 文字ごと。上限 40 個を超える長さにする。
    const produce = vi.fn(() => ({ text: 'x'.repeat(1_300_000) }))

    cache.withJson('ns', ['k'], 60, false, produce)
    cache.withJson('ns', ['k'], 60, false, produce)
    expect(produce).toHaveBeenCalledTimes(2)
  })

  it('上限を超える値を書こうとしたら、同じキーの古い値も無効にする', () => {
    const { cache } = createCache()
    const small = { text: 'small' }
    const big = { text: 'x'.repeat(1_300_000) }

    cache.withJson('ns', ['k'], 60, false, () => small)
    // 再読込でキャッシュを無視して取り直したら、収まらない大きさになった。
    cache.withJson('ns', ['k'], 60, true, () => big)

    // 古い値を残すと、次の通常の読み出しが更新前の内容を返してしまう。
    const produce = vi.fn(() => big)
    cache.withJson('ns', ['k'], 60, false, produce)
    expect(produce).toHaveBeenCalledTimes(1)
  })

  it('サロゲートペアを含む値も断片の境界で壊れない', () => {
    const { cache } = createCache()
    // 断片の境界（30,000 文字目）をペアの途中に合わせる。
    const value = { text: `${'x'.repeat(29_999)}🎉${'y'.repeat(30_000)}` }

    cache.withJson('ns', ['k'], 60, false, () => value)
    expect(cache.withJson('ns', ['k'], 60, false, () => value)).toEqual(value)
  })

  it('produce が undefined を返したら保持しない', () => {
    const { store, cache } = createCache()
    const produce = vi.fn(() => undefined)

    cache.withJson('ns', ['k'], 60, false, produce)
    cache.withJson('ns', ['k'], 60, false, produce)
    // 失敗を表す値をキャッシュすると、復旧しても期限まで配り続けることになる。
    expect(produce).toHaveBeenCalledTimes(2)
    expect(store.keys()).toEqual([])
  })
})

describe('readText / writeText', () => {
  it('文字列をそのまま読み書きできる', () => {
    const { cache } = createCache()

    expect(cache.readText('icon', ['1'])).toBeNull()
    cache.writeText('icon', ['1'], 'data:image/png;base64,AAAA', 60)
    expect(cache.readText('icon', ['1'])).toBe('data:image/png;base64,AAAA')
  })

  it('キーが違えば混ざらない', () => {
    const { cache } = createCache()

    cache.writeText('icon', ['1'], 'one', 60)
    cache.writeText('icon', ['2'], 'two', 60)
    expect(cache.readText('icon', ['1'])).toBe('one')
    expect(cache.readText('icon', ['2'])).toBe('two')
  })
})

describe('createNullJsonCache', () => {
  it('毎回 produce を呼ぶ', () => {
    const cache = createNullJsonCache()
    const produce = vi.fn(() => ({ value: 1 }))

    cache.withJson('ns', ['k'], 60, false, produce)
    cache.withJson('ns', ['k'], 60, false, produce)
    expect(produce).toHaveBeenCalledTimes(2)
  })

  it('書いた文字列も覚えない', () => {
    const cache = createNullJsonCache()

    cache.writeText('icon', ['1'], 'x', 60)
    expect(cache.readText('icon', ['1'])).toBeNull()
  })
})
