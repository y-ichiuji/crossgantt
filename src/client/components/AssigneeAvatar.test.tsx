import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { installBootstrap, installScriptRun, removeBootstrap } from '../test-utils'
import type { ScriptRunStub } from '../test-utils'
import { AssigneeAvatar } from './AssigneeAvatar'

const ICON = 'data:image/png;base64,AAAA'

let stub: ScriptRunStub | null = null

afterEach(() => {
  stub?.restore()
  stub = null
  removeBootstrap()
})

describe('AssigneeAvatar', () => {
  it('サーバーから受け取った data URL を読み込む', async () => {
    installBootstrap()
    stub = installScriptRun(() => ({ ok: true, data: { 42: ICON } }))

    render(<AssigneeAvatar assigneeId={42} assigneeName="山田太郎" />)

    const image = await waitFor(() => {
      const found = document.querySelector('img')
      expect(found).not.toBeNull()
      return found
    })
    expect(image?.getAttribute('src')).toBe(ICON)
    // 頭文字が下に見えるので、画像自体は装飾扱いにする。
    expect(image?.getAttribute('alt')).toBe('')
    expect(image?.getAttribute('loading')).toBe('lazy')
    expect(stub.calls[0]).toEqual({ name: 'icons', params: { userIds: '42' } })
  })

  it('同じ担当者が並んでも取得は 1 回にまとめる', async () => {
    installBootstrap()
    stub = installScriptRun(() => ({ ok: true, data: { 42: ICON, 43: ICON } }))

    render(
      <>
        <AssigneeAvatar assigneeId={42} assigneeName="山田太郎" />
        <AssigneeAvatar assigneeId={42} assigneeName="山田太郎" />
        <AssigneeAvatar assigneeId={43} assigneeName="鈴木花子" />
      </>
    )

    await waitFor(() => {
      expect(document.querySelectorAll('img')).toHaveLength(3)
    })
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0].params.userIds).toBe('42,43')
  })

  it('1 回の上限を超える担当者は分けて取りに行く', async () => {
    installBootstrap()
    stub = installScriptRun(({ params }) => {
      const ids = params.userIds.split(',')
      return { ok: true, data: Object.fromEntries(ids.map((id) => [id, ICON])) }
    })
    const ids = Array.from({ length: 61 }, (_value, index) => index + 1)

    render(
      <>
        {ids.map((id) => (
          <AssigneeAvatar key={id} assigneeId={id} assigneeName={`担当 ${id}`} />
        ))}
      </>
    )

    await waitFor(() => {
      expect(document.querySelectorAll('img')).toHaveLength(61)
    })
    expect(stub.calls).toHaveLength(2)
    expect(stub.calls[0].params.userIds.split(',')).toHaveLength(60)
    expect(stub.calls[1].params.userIds).toBe('61')
  })

  it('取得できなかった担当者は頭文字だけで表示する', async () => {
    installBootstrap()
    stub = installScriptRun(() => ({ ok: true, data: {} }))

    render(<AssigneeAvatar assigneeId={42} assigneeName="山田太郎" />)

    await waitFor(() => {
      expect(stub?.calls).toHaveLength(1)
    })
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('山')).toBeDefined()
  })

  it('サーバーが無い環境では取得を試みない', () => {
    render(<AssigneeAvatar assigneeId={42} assigneeName="山田太郎" />)

    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByTitle('山田太郎')).toBeDefined()
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
    installBootstrap()
    stub = installScriptRun(() => ({ ok: true, data: {} }))

    render(<AssigneeAvatar assigneeId={null} assigneeName={null} />)

    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByTitle('未割り当て')).toBeDefined()
    expect(stub.calls).toHaveLength(0)
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
