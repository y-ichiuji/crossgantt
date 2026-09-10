import { describe, expect, it } from 'vitest'

import { createMemoryKV, TEST_SESSION } from '../test-utils'
import {
  buildClearCookie,
  buildCookie,
  deleteSession,
  getSession,
  putSession,
  putState,
  randomId,
  readCookie,
  sanitizeReturnTo,
  takeState
} from './session'

describe('randomId', () => {
  it('指定バイト数の 16 進文字列を返す', () => {
    expect(randomId(8)).toMatch(/^[0-9a-f]{16}$/u)
    expect(randomId()).toHaveLength(64)
  })

  it('毎回異なる値になる', () => {
    const ids = new Set(Array.from({ length: 50 }, () => randomId(16)))
    expect(ids.size).toBe(50)
  })
})

describe('セッションの保存と取得', () => {
  it('保存した内容をそのまま取り出せる', async () => {
    const kv = createMemoryKV()
    await putSession(kv, 'sid', TEST_SESSION)
    expect(await getSession(kv, 'sid')).toEqual(TEST_SESSION)
  })

  it('存在しない ID には null を返す', async () => {
    const kv = createMemoryKV()
    expect(await getSession(kv, 'missing')).toBeNull()
  })

  it('削除できる', async () => {
    const kv = createMemoryKV()
    await putSession(kv, 'sid', TEST_SESSION)
    await deleteSession(kv, 'sid')
    expect(await getSession(kv, 'sid')).toBeNull()
  })

  it('有効期限を過ぎたら読めなくなる', async () => {
    let now = Date.parse('2026-09-10T00:00:00Z')
    const kv = createMemoryKV(() => now)
    await putSession(kv, 'sid', TEST_SESSION)
    expect(await getSession(kv, 'sid')).not.toBeNull()

    now += 31 * 24 * 60 * 60 * 1000
    expect(await getSession(kv, 'sid')).toBeNull()
  })
})

describe('state の保存と消費', () => {
  it('一度取り出したら消える（再利用を防ぐ）', async () => {
    const kv = createMemoryKV()
    await putState(kv, 'st', { space: 'example.backlog.jp', returnTo: '/' })

    expect(await takeState(kv, 'st')).toEqual({ space: 'example.backlog.jp', returnTo: '/' })
    expect(await takeState(kv, 'st')).toBeNull()
  })

  it('存在しない state には null を返す', async () => {
    const kv = createMemoryKV()
    expect(await takeState(kv, 'missing')).toBeNull()
  })
})

describe('sanitizeReturnTo', () => {
  it('相対パスはそのまま通す', () => {
    expect(sanitizeReturnTo('/?projects=1,2')).toBe('/?projects=1,2')
  })

  it('外部 URL やプロトコル相対 URL は / に落とす', () => {
    expect(sanitizeReturnTo('//evil.example.com')).toBe('/')
    expect(sanitizeReturnTo('https://evil.example.com')).toBe('/')
    // oxlint-disable-next-line no-script-url -- 弾けることを確かめるための入力。
    expect(sanitizeReturnTo('javascript:alert(1)')).toBe('/')
  })

  it('バックスラッシュや制御文字でオリジンを差し替える形も / に落とす', () => {
    // ブラウザは URL 解決時に `\` を `/` と同じに扱い、タブや改行は取り除く。
    // そのため以下はいずれも `//evil.example.com` と同じ意味になり、
    // 先頭の 2 文字だけを見る検査では素通りしてしまう。
    expect(sanitizeReturnTo(String.raw`/\evil.example.com`)).toBe('/')
    expect(sanitizeReturnTo(String.raw`/\/evil.example.com`)).toBe('/')
    expect(sanitizeReturnTo('/\t/evil.example.com')).toBe('/')
    expect(sanitizeReturnTo('/\n//evil.example.com')).toBe('/')
  })

  it('クエリやフラグメント付きの相対パスは保つ', () => {
    expect(sanitizeReturnTo('/?projects=1,2&group=assignee')).toBe('/?projects=1,2&group=assignee')
    expect(sanitizeReturnTo('/path/sub?a=1#frag')).toBe('/path/sub?a=1#frag')
  })

  it('未指定なら / を返す', () => {
    expect(sanitizeReturnTo(null)).toBe('/')
    expect(sanitizeReturnTo(undefined)).toBe('/')
    expect(sanitizeReturnTo('')).toBe('/')
  })
})

describe('Cookie の組み立て', () => {
  it('HttpOnly と SameSite を必ず付ける', () => {
    const cookie = buildCookie('cg_session', 'abc', { secure: true, maxAge: 60 })
    expect(cookie).toContain('cg_session=abc')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('Max-Age=60')
  })

  it('http のときは Secure を付けない', () => {
    expect(buildCookie('cg_session', 'abc', { secure: false })).not.toContain('Secure')
  })

  it('削除用の Cookie は Max-Age=0', () => {
    expect(buildClearCookie('cg_session', true)).toContain('Max-Age=0')
  })
})

describe('readCookie', () => {
  it('複数の Cookie から目的の値を取り出す', () => {
    expect(readCookie('a=1; cg_session=xyz; b=2', 'cg_session')).toBe('xyz')
  })

  it('前後の空白を取り除く', () => {
    expect(readCookie('  cg_session = xyz  ', 'cg_session')).toBe('xyz')
  })

  it('見つからなければ null', () => {
    expect(readCookie('a=1', 'cg_session')).toBeNull()
    expect(readCookie(null, 'cg_session')).toBeNull()
    expect(readCookie(undefined, 'cg_session')).toBeNull()
  })

  it('名前の部分一致では取り出さない', () => {
    expect(readCookie('xcg_session=wrong', 'cg_session')).toBeNull()
  })
})
