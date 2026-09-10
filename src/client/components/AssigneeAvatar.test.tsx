import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AssigneeAvatar } from './AssigneeAvatar'

describe('AssigneeAvatar', () => {
  it('Worker 経由のアイコン URL を読み込む', () => {
    render(<AssigneeAvatar assigneeId={42} assigneeName="山田太郎" />)
    const image = document.querySelector('img')
    expect(image?.getAttribute('src')).toBe('/api/users/42/icon')
    // 頭文字が下に見えるので、画像自体は装飾扱いにする。
    expect(image?.getAttribute('alt')).toBe('')
    expect(image?.getAttribute('loading')).toBe('lazy')
  })

  it('担当者名を title に出す', () => {
    render(<AssigneeAvatar assigneeId={42} assigneeName="山田太郎" />)
    expect(screen.getByTitle('山田太郎')).toBeDefined()
  })

  it('画像が読めなかったときのために頭文字を置く', () => {
    render(<AssigneeAvatar assigneeId={42} assigneeName="山田太郎" />)
    expect(screen.getByText('山')).toBeDefined()
  })

  it('サロゲートペアの名前でも 1 文字目を取り出す', () => {
    render(<AssigneeAvatar assigneeId={1} assigneeName="𩸽太郎" />)
    expect(screen.getByText('𩸽')).toBeDefined()
  })

  it('未割り当てなら画像を読み込まない', () => {
    render(<AssigneeAvatar assigneeId={null} assigneeName={null} />)
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByTitle('未割り当て')).toBeDefined()
  })

  it('サイズを指定できる', () => {
    render(<AssigneeAvatar assigneeId={1} assigneeName="A" size="md" />)
    expect(screen.getByTitle('A').getAttribute('data-size')).toBe('md')
  })

  it('既定のサイズは sm', () => {
    render(<AssigneeAvatar assigneeId={1} assigneeName="A" />)
    expect(screen.getByTitle('A').getAttribute('data-size')).toBe('sm')
  })
})
