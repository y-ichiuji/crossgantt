import { describe, expect, it, vi } from 'vitest'
import { BacklogApiError, BacklogClient, mapWithConcurrency } from '../src/server/backlog/client'

const SPACE = 'example.backlog.jp'
const API_KEY = 'super-secret-key'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init
  })
}

describe('BacklogClient.get', () => {
  it('API キーをクエリに付けて呼び出す', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true })) as unknown as typeof fetch
    const client = new BacklogClient({ space: SPACE, apiKey: API_KEY, fetchImpl })

    await client.get('/users/myself')

    const called = new URL((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    expect(called.origin).toBe(`https://${SPACE}`)
    expect(called.pathname).toBe('/api/v2/users/myself')
    expect(called.searchParams.get('apiKey')).toBe(API_KEY)
  })

  it('配列パラメータを繰り返し形式で展開する', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([])) as unknown as typeof fetch
    const client = new BacklogClient({ space: SPACE, apiKey: API_KEY, fetchImpl })

    await client.get('/issues', { 'projectId[]': [1, 2], count: 100, keyword: undefined })

    const called = new URL((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
    expect(called.searchParams.getAll('projectId[]')).toEqual(['1', '2'])
    expect(called.searchParams.get('count')).toBe('100')
    expect(called.searchParams.has('keyword')).toBe(false)
  })

  it('レート制限ヘッダーを記録する', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {},
        {
          headers: {
            'X-RateLimit-Limit': '150',
            'X-RateLimit-Remaining': '149',
            'X-RateLimit-Reset': '1780000000'
          }
        }
      )
    ) as unknown as typeof fetch
    const client = new BacklogClient({ space: SPACE, apiKey: API_KEY, fetchImpl })

    await client.get('/issues')

    expect(client.lastRateLimit).toEqual({ limit: 150, remaining: 149, reset: 1780000000 })
  })

  it('429 を受けたら待ってリトライする', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        return new Response('too many', { status: 429, headers: { 'Retry-After': '1' } })
      }
      return jsonResponse({ ok: true })
    }) as unknown as typeof fetch
    const sleep = vi.fn(async () => {})
    const client = new BacklogClient({ space: SPACE, apiKey: API_KEY, fetchImpl, sleep })

    await expect(client.get('/issues')).resolves.toEqual({ ok: true })
    expect(sleep).toHaveBeenCalledWith(1000)
    expect(client.requestCount).toBe(2)
  })

  it('待ち時間が長すぎる場合はリトライせず 429 を返す', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('too many', { status: 429, headers: { 'Retry-After': '300' } })
    ) as unknown as typeof fetch
    const sleep = vi.fn(async () => {})
    const client = new BacklogClient({ space: SPACE, apiKey: API_KEY, fetchImpl, sleep })

    await expect(client.get('/issues')).rejects.toThrow(BacklogApiError)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('リトライ上限を超えたらエラーになる', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch
    const sleep = vi.fn(async () => {})
    const client = new BacklogClient({ space: SPACE, apiKey: API_KEY, fetchImpl, sleep, maxRetries: 2 })

    await expect(client.get('/issues')).rejects.toThrow(BacklogApiError)
    expect(client.requestCount).toBe(3)
  })

  it('401 はリトライせず、分かりやすいメッセージにする', async () => {
    const fetchImpl = vi.fn(async () => new Response('unauthorized', { status: 401 })) as unknown as typeof fetch
    const client = new BacklogClient({ space: SPACE, apiKey: API_KEY, fetchImpl })

    await expect(client.get('/users/myself')).rejects.toMatchObject({
      status: 401,
      message: 'API キーが正しくありません'
    })
    expect(client.requestCount).toBe(1)
  })

  it('エラー本文に API キーが含まれてもマスクする', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(`invalid apiKey=${API_KEY}`, { status: 400 })
    ) as unknown as typeof fetch
    const client = new BacklogClient({ space: SPACE, apiKey: API_KEY, fetchImpl })

    const error = (await client.get('/issues').catch((caught: unknown) => caught)) as BacklogApiError
    expect(error.detail).toBe('invalid apiKey=***')
    expect(error.detail).not.toContain(API_KEY)
  })

  it('既定の fetch は globalThis に束縛して呼ぶ', async () => {
    // Workers のグローバル fetch は this が globalThis でないと
    // Illegal invocation で失敗する。インスタンスのプロパティ経由で
    // 呼んでも this が壊れないことを確認する。
    const original = globalThis.fetch
    const receivedThis: unknown[] = []
    globalThis.fetch = function mockFetch(this: unknown) {
      receivedThis.push(this)
      return Promise.resolve(jsonResponse({ ok: true }))
    } as unknown as typeof fetch

    try {
      const client = new BacklogClient({ space: SPACE, apiKey: API_KEY })
      await client.get('/users/myself')
    } finally {
      globalThis.fetch = original
    }

    expect(receivedThis).toHaveLength(1)
    expect(receivedThis[0]).toBe(globalThis)
  })

  it('ネットワークエラーは 502 として扱う', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network down')
    }) as unknown as typeof fetch
    const client = new BacklogClient({ space: SPACE, apiKey: API_KEY, fetchImpl })

    await expect(client.get('/issues')).rejects.toMatchObject({ status: 502 })
  })
})

describe('mapWithConcurrency', () => {
  it('全要素を順序どおりに処理する', async () => {
    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => value * 2)
    expect(result).toEqual([2, 4, 6, 8, 10])
  })

  it('同時実行数が上限を超えない', async () => {
    let active = 0
    let peak = 0
    await mapWithConcurrency(
      Array.from({ length: 12 }, (_, index) => index),
      3,
      async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 1))
        active -= 1
      }
    )
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('空配列でも動く', async () => {
    await expect(mapWithConcurrency([], 5, async () => 1)).resolves.toEqual([])
  })
})
