import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { LoginPanel } from './LoginPanel'

function setup(props: Partial<React.ComponentProps<typeof LoginPanel>> = {}) {
  const onSubmit = vi.fn()
  render(<LoginPanel initialSpace="" onSubmit={onSubmit} submitting={false} error={null} {...props} />)
  return { onSubmit, user: userEvent.setup() }
}

describe('LoginPanel', () => {
  it('スペース入力欄とログインボタンを表示する', () => {
    setup()
    expect(screen.getByLabelText('スペースドメイン')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Backlog でログイン' })).toBeDefined()
  })

  it('初期値を入力欄に反映する', () => {
    setup({ initialSpace: 'example.backlog.jp' })
    expect((screen.getByLabelText('スペースドメイン') as HTMLInputElement).value).toBe('example.backlog.jp')
  })

  it('入力してログインすると値が渡る', async () => {
    const { onSubmit, user } = setup()
    await user.type(screen.getByLabelText('スペースドメイン'), 'example.backlog.jp')
    await user.click(screen.getByRole('button', { name: 'Backlog でログイン' }))
    expect(onSubmit).toHaveBeenCalledWith('example.backlog.jp')
  })

  it('前後の空白を取り除いて渡す', async () => {
    const { onSubmit, user } = setup()
    await user.type(screen.getByLabelText('スペースドメイン'), '  example.backlog.jp  ')
    await user.click(screen.getByRole('button', { name: 'Backlog でログイン' }))
    expect(onSubmit).toHaveBeenCalledWith('example.backlog.jp')
  })

  it('submitting 中はボタンを無効にする', () => {
    setup({ submitting: true })
    const button = screen.getByRole('button', { name: /Backlog へ移動しています/u }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('エラーを alert として表示する', () => {
    setup({ error: '認可の有効期限が切れました' })
    expect(screen.getByRole('alert').textContent).toBe('認可の有効期限が切れました')
  })

  it('onCancel が無ければキャンセルボタンを出さない', () => {
    setup()
    expect(screen.queryByRole('button', { name: 'キャンセル' })).toBeNull()
  })

  it('onCancel があればキャンセルできる', async () => {
    const onCancel = vi.fn()
    const { user } = setup({ onCancel })
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('読み取り専用であることを説明する', () => {
    setup()
    expect(screen.getByText(/読み取り専用/u)).toBeDefined()
    expect(screen.getByText(/HttpOnly Cookie/u)).toBeDefined()
  })

  it('API キーの入力欄を持たない', () => {
    setup()
    expect(screen.queryByLabelText(/API キー/u)).toBeNull()
    expect(document.querySelector('input[type="password"]')).toBeNull()
  })
})
