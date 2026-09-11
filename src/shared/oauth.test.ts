import { describe, expect, it } from 'vitest'

import { buildAuthorizeUrl, decodeState, encodeState, MAX_STATE_QUERY_LENGTH } from './oauth'

const SPACE = 'example.backlog.jp'
const NONCE = 'a1b2c3d4e5f60718'
const REDIRECT_URI = 'https://script.google.com/macros/s/deployment-id/exec'

describe('buildAuthorizeUrl', () => {
  it('スペースの認可エンドポイントへ必要なパラメータを付ける', () => {
    const url = new URL(
      buildAuthorizeUrl({ space: SPACE, clientId: 'client-id', redirectUri: REDIRECT_URI, state: 'state-value' })
    )

    expect(url.origin).toBe(`https://${SPACE}`)
    expect(url.pathname).toBe('/OAuth2AccessRequest.action')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('client-id')
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI)
    expect(url.searchParams.get('state')).toBe('state-value')
  })

  it('state に含まれる記号もそのまま復元できる形で載せる', () => {
    const state = encodeState({ nonce: NONCE, space: SPACE, query: 'from=2026-09-01&keyword=%E3%81%82+%26' })
    const url = new URL(buildAuthorizeUrl({ space: SPACE, clientId: 'client-id', redirectUri: REDIRECT_URI, state }))

    expect(url.searchParams.get('state')).toBe(state)
    expect(decodeState(url.searchParams.get('state'))).toEqual({
      nonce: NONCE,
      space: SPACE,
      query: 'from=2026-09-01&keyword=%E3%81%82+%26'
    })
  })
})

describe('encodeState / decodeState', () => {
  it('往復して同じ内容になる', () => {
    const parts = { nonce: NONCE, space: SPACE, query: 'projects=1,2&from=2026-09-01' }
    expect(decodeState(encodeState(parts))).toEqual(parts)
  })

  it('表示条件が空でも扱える', () => {
    expect(decodeState(encodeState({ nonce: NONCE, space: SPACE, query: '' }))).toEqual({
      nonce: NONCE,
      space: SPACE,
      query: ''
    })
  })

  it('許可されないスペースは受け付けない', () => {
    // state はクライアントが組み立てるため、スペースは必ず検証し直す。
    expect(decodeState(`${NONCE}|evil.example.com|`)).toBeNull()
    expect(decodeState(`${NONCE}|example.backlog.jp.evil.com|`)).toBeNull()
  })

  it('nonce の形が合わない値は受け付けない', () => {
    expect(decodeState(`short|${SPACE}|`)).toBeNull()
    expect(decodeState(`ABCDEF0123456789|${SPACE}|`)).toBeNull()
    expect(decodeState(`../../etc|${SPACE}|`)).toBeNull()
  })

  it('区切りが足りない値は受け付けない', () => {
    expect(decodeState(NONCE)).toBeNull()
    expect(decodeState('')).toBeNull()
    expect(decodeState(null)).toBeNull()
    expect(decodeState(undefined)).toBeNull()
  })

  it('表示条件が長すぎる場合は載せる前に切る', () => {
    const state = encodeState({ nonce: NONCE, space: SPACE, query: 'x'.repeat(MAX_STATE_QUERY_LENGTH + 100) })
    expect(decodeState(state)?.query).toHaveLength(MAX_STATE_QUERY_LENGTH)
  })

  it('長すぎる表示条件を含む state は受け付けない', () => {
    const state = `${NONCE}|${SPACE}|${'x'.repeat(MAX_STATE_QUERY_LENGTH + 1)}`
    expect(decodeState(state)).toBeNull()
  })

  it('スペースは正規化して返す', () => {
    expect(decodeState(`${NONCE}|EXAMPLE.Backlog.JP|`)?.space).toBe(SPACE)
  })
})
