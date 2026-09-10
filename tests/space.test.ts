import { describe, expect, it } from 'vitest'
import { issueUrl, normalizeSpace } from '../src/server/backlog/space'

describe('normalizeSpace', () => {
  it('Backlog の公式ドメインを受け付ける', () => {
    expect(normalizeSpace('example.backlog.jp')).toBe('example.backlog.jp')
    expect(normalizeSpace('example.backlog.com')).toBe('example.backlog.com')
    expect(normalizeSpace('example.backlogtool.com')).toBe('example.backlogtool.com')
  })

  it('スキーム・末尾スラッシュ・大文字・空白を吸収する', () => {
    expect(normalizeSpace('  HTTPS://Example.Backlog.JP/  ')).toBe('example.backlog.jp')
    expect(normalizeSpace('http://example.backlog.jp/dashboard')).toBe('example.backlog.jp')
  })

  it('ハイフンや数字を含むサブドメインを許可する', () => {
    expect(normalizeSpace('my-space01.backlog.jp')).toBe('my-space01.backlog.jp')
  })

  it('Backlog 以外のホストを拒否する', () => {
    expect(normalizeSpace('evil.example.com')).toBeNull()
    expect(normalizeSpace('backlog.jp')).toBeNull()
    expect(normalizeSpace('evil.com/example.backlog.jp')).toBeNull()
    expect(normalizeSpace('example.backlog.jp.evil.com')).toBeNull()
  })

  it('サブドメインが不正なものを拒否する', () => {
    expect(normalizeSpace('.backlog.jp')).toBeNull()
    expect(normalizeSpace('-bad.backlog.jp')).toBeNull()
    expect(normalizeSpace('a_b.backlog.jp')).toBeNull()
    expect(normalizeSpace('sub.domain.backlog.jp')).toBeNull()
  })

  it('ポートや認証情報付きのホストを拒否する', () => {
    expect(normalizeSpace('example.backlog.jp:8080')).toBeNull()
    expect(normalizeSpace('user@example.backlog.jp')).toBeNull()
  })

  it('空値を拒否する', () => {
    expect(normalizeSpace('')).toBeNull()
    expect(normalizeSpace(null)).toBeNull()
    expect(normalizeSpace(undefined)).toBeNull()
  })
})

describe('issueUrl', () => {
  it('課題の閲覧 URL を組み立てる', () => {
    expect(issueUrl('example.backlog.jp', 'PJA-123')).toBe('https://example.backlog.jp/view/PJA-123')
  })
})
