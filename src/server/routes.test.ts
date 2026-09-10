import { describe, expect, it } from 'vitest'

import { api } from './routes'

const VALID_HEADERS = {
  'X-Backlog-Space': 'example.backlog.jp',
  'X-Backlog-Api-Key': 'abcdefghijklmnop'
}

/**
 * ここでは Backlog へ実際に到達する前に弾かれるケースだけを検証する。
 * 中継そのものの検証は BacklogClient 側のテストで行う。
 */
describe('プロキシ API のガード', () => {
  it('スペースが未指定なら 400', async () => {
    const response = await api.request('/projects', {
      headers: { 'X-Backlog-Api-Key': 'abcdefghijklmnop' }
    })
    expect(response.status).toBe(400)
  })

  it('Backlog 以外のホストは 400 で拒否する', async () => {
    const response = await api.request('/projects', {
      headers: { 'X-Backlog-Space': 'evil.example.com', 'X-Backlog-Api-Key': 'abcdefghijklmnop' }
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('スペースドメイン')
  })

  it('API キーが未指定なら 401', async () => {
    const response = await api.request('/projects', {
      headers: { 'X-Backlog-Space': 'example.backlog.jp' }
    })
    expect(response.status).toBe(401)
  })

  it('API キーの形式が不正なら 401', async () => {
    const response = await api.request('/projects', {
      headers: { 'X-Backlog-Space': 'example.backlog.jp', 'X-Backlog-Api-Key': 'short' }
    })
    expect(response.status).toBe(401)
  })

  it('認証情報を含むレスポンスはキャッシュさせない', async () => {
    const response = await api.request('/projects', { headers: { 'X-Backlog-Space': 'evil.example.com' } })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('/issues のパラメータ検証', () => {
  it('プロジェクト未指定なら 400', async () => {
    const response = await api.request('/issues?from=2026-09-01&to=2026-09-30', { headers: VALID_HEADERS })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('プロジェクト')
  })

  it('日付形式が不正なら 400', async () => {
    const response = await api.request('/issues?projectIds=1&from=2026-13-01&to=2026-09-30', {
      headers: VALID_HEADERS
    })
    expect(response.status).toBe(400)
  })

  it('期間が逆転していたら 400', async () => {
    const response = await api.request('/issues?projectIds=1&from=2026-10-01&to=2026-09-01', {
      headers: VALID_HEADERS
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('開始日')
  })
})
