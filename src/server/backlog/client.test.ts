import { describe, expect, it, vi } from 'vitest'

import { createFetcherStub, jsonResponse, textResponse } from '../test-utils'
import { BacklogApiError, BacklogClient } from './client'

const SPACE = 'example.backlog.jp'
const ACCESS_TOKEN = 'super-secret-token'

function createClient(
  stub: ReturnType<typeof createFetcherStub>,
  options: { maxRetries?: number; batchSize?: number; sleep?: (ms: number) => void; now?: () => number } = {}
) {
  return new BacklogClient({ space: SPACE, accessToken: ACCESS_TOKEN, fetcher: stub.fetcher, ...options })
}

describe('BacklogClient.get', () => {
  it('アクセストークンを Authorization ヘッダーで送る', () => {
    const stub = createFetcherStub(() => jsonResponse({ ok: true }))

    createClient(stub).get('/users/myself')

    const called = new URL(stub.requests[0].url)
    expect(called.origin).toBe(`https://${SPACE}`)
    expect(called.pathname).toBe('/api/v2/users/myself')
    expect(stub.requests[0].headers?.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
  })

  it('アクセストークンを URL に含めない', () => {
    const stub = createFetcherStub(() => jsonResponse({ ok: true }))

    createClient(stub).get('/users/myself')

    expect(stub.requests[0].url).not.toContain(ACCESS_TOKEN)
    expect(new URL(stub.requests[0].url).searchParams.has('apiKey')).toBe(false)
  })

  it('配列パラメータを繰り返し形式で展開する', () => {
    const stub = createFetcherStub(() => jsonResponse([]))

    createClient(stub).get('/issues', { 'projectId[]': [1, 2], count: 100, keyword: undefined })

    const called = new URL(stub.requests[0].url)
    expect(called.searchParams.getAll('projectId[]')).toEqual(['1', '2'])
    expect(called.searchParams.get('count')).toBe('100')
    expect(called.searchParams.has('keyword')).toBe(false)
  })

  it('レート制限ヘッダーを記録する', () => {
    const stub = createFetcherStub(() =>
      jsonResponse({}, 200, {
        'X-RateLimit-Limit': '150',
        'X-RateLimit-Remaining': '149',
        'X-RateLimit-Reset': '1780000000'
      })
    )
    const client = createClient(stub)

    client.get('/issues')

    expect(client.lastRateLimit).toEqual({ limit: 150, remaining: 149, reset: 1_780_000_000 })
  })

  it('JSON として読めない応答は 502 にする', () => {
    const stub = createFetcherStub(() => textResponse(200, 'not json'))

    expect(() => createClient(stub).get('/issues')).toThrow(BacklogApiError)
  })

  it('429 を受けたら待ってリトライする', () => {
    const stub = createFetcherStub((_request, index) =>
      index === 0 ? textResponse(429, 'too many', { 'Retry-After': '1' }) : jsonResponse({ ok: true })
    )
    const sleep = vi.fn()
    const client = createClient(stub, { sleep })

    expect(client.get('/issues')).toEqual({ ok: true })
    expect(sleep).toHaveBeenCalledWith(1000)
    expect(client.requestCount).toBe(2)
  })

  it('待ち時間が長すぎる場合はリトライせず 429 を返す', () => {
    const stub = createFetcherStub(() => textResponse(429, 'too many', { 'Retry-After': '300' }))
    const sleep = vi.fn()
    const client = createClient(stub, { sleep })

    expect(() => client.get('/issues')).toThrow(BacklogApiError)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('リトライ上限を超えたらエラーになる', () => {
    const stub = createFetcherStub(() => textResponse(500, 'boom'))
    const client = createClient(stub, { sleep: vi.fn(), maxRetries: 2 })

    expect(() => client.get('/issues')).toThrow(BacklogApiError)
    expect(client.requestCount).toBe(3)
  })

  it('401 はリトライせず、分かりやすいメッセージにする', () => {
    const stub = createFetcherStub(() => textResponse(401, 'unauthorized'))
    const client = createClient(stub)

    expect(() => client.get('/users/myself')).toThrow(
      expect.objectContaining({
        status: 401,
        message: 'Backlog の認証が切れています。ログインし直してください'
      })
    )
    expect(client.requestCount).toBe(1)
  })

  it('エラー本文にアクセストークンが含まれてもマスクする', () => {
    const stub = createFetcherStub(() => textResponse(400, `invalid token=${ACCESS_TOKEN}`))

    let thrown: unknown
    try {
      createClient(stub).get('/issues')
    } catch (error: unknown) {
      thrown = error
    }

    expect((thrown as BacklogApiError).detail).toBe('invalid token=***')
    expect((thrown as BacklogApiError).detail).not.toContain(ACCESS_TOKEN)
  })

  it('通信そのものの失敗は 502 として扱う', () => {
    const stub = createFetcherStub(() => {
      throw new TypeError('network down')
    })

    expect(() => createClient(stub).get('/issues')).toThrow(expect.objectContaining({ status: 502 }))
  })
})

describe('BacklogClient.getMany', () => {
  it('引数と同じ並びで返す', () => {
    const stub = createFetcherStub((request) => jsonResponse({ url: request.url }))

    const results = createClient(stub).getMany<{ url: string }>([{ path: '/a' }, { path: '/b' }, { path: '/c' }])

    expect(results.map((result) => new URL(result.url).pathname)).toEqual(['/api/v2/a', '/api/v2/b', '/api/v2/c'])
  })

  it('空配列では何も投げない', () => {
    const stub = createFetcherStub(() => jsonResponse({}))

    expect(createClient(stub).getMany([])).toEqual([])
    expect(stub.requests).toHaveLength(0)
  })

  it('指定した本数ずつまとめて投げる', () => {
    const stub = createFetcherStub(() => jsonResponse({}))

    createClient(stub, { batchSize: 2 }).getMany(Array.from({ length: 5 }, (_value, index) => ({ path: `/p${index}` })))

    expect(stub.batches.map((batch) => batch.length)).toEqual([2, 2, 1])
  })

  it('失敗した分だけを投げ直す', () => {
    // 1 本目だけ 429 を返し、2 本目は最初から成功させる。
    const stub = createFetcherStub((request) =>
      request.url.includes('/first') && !request.url.includes('retry')
        ? textResponse(429, 'too many', { 'Retry-After': '1' })
        : jsonResponse({ ok: true })
    )
    const client = createClient(stub, { sleep: vi.fn() })

    // 2 回目の呼び出しでは URL を変えられないため、リトライ本数だけを見る。
    expect(() => client.getMany([{ path: '/first' }, { path: '/second' }])).toThrow(BacklogApiError)
    // 1 回目に 2 本、リトライで 1 本（/first のみ）、さらにリトライで 1 本。
    expect(stub.batches.map((batch) => batch.length)).toEqual([2, 1, 1])
  })
})

describe('BacklogClient.getBinary', () => {
  it('Base64 と Content-Type を返す', () => {
    const stub = createFetcherStub(() => textResponse(200, 'image-bytes', { 'Content-Type': 'image/gif' }))

    const content = createClient(stub).getBinary('/users/1/icon')

    expect(content.contentType).toBe('image/gif')
    expect(Buffer.from(content.base64, 'base64').toString('utf8')).toBe('image-bytes')
    expect(stub.requests[0].headers?.Accept).toBe('image/*')
  })

  it('Content-Type が無い場合は image/png とみなす', () => {
    const stub = createFetcherStub(() => textResponse(200, 'x'))

    expect(createClient(stub).getBinary('/users/1/icon').contentType).toBe('image/png')
  })
})
