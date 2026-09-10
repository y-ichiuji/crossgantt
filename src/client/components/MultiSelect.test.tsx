import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MultiSelect } from './MultiSelect'
import type { MultiSelectOption } from './MultiSelect'

const OPTIONS: MultiSelectOption[] = [
  { value: '1', label: 'プロジェクトA', color: '#3b82f6' },
  { value: '2', label: 'プロジェクトB' },
  { value: '3', label: 'その他' }
]

function setup(props: Partial<React.ComponentProps<typeof MultiSelect>> = {}) {
  const onChange = vi.fn()
  render(
    <MultiSelect
      label="プロジェクト"
      options={OPTIONS}
      selected={[]}
      onChange={onChange}
      emptyLabel="未選択"
      {...props}
    />
  )
  return { onChange, user: userEvent.setup() }
}

describe('MultiSelect', () => {
  it('未選択のときは emptyLabel を表示する', () => {
    setup()
    expect(screen.getByRole('button', { name: /未選択/u })).toBeDefined()
  })

  it('選択数を表示する', () => {
    setup({ selected: ['1', '2'] })
    expect(screen.getByRole('button', { name: /2件選択/u })).toBeDefined()
  })

  it('選択肢が無ければボタンを無効にする', () => {
    setup({ options: [] })
    const trigger = screen.getByRole('button', { name: /選択肢がありません/u }) as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
  })

  it('disabled を渡すとボタンが無効になる', () => {
    setup({ disabled: true })
    expect((screen.getByRole('button', { name: /未選択/u }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('クリックで開いて選択肢を表示する', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: /未選択/u }))
    expect(screen.getByLabelText('プロジェクトA')).toBeDefined()
    expect(screen.getByLabelText('プロジェクトB')).toBeDefined()
  })

  it('チェックすると値が追加される', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole('button', { name: /未選択/u }))
    await user.click(screen.getByLabelText('プロジェクトB'))
    expect(onChange).toHaveBeenCalledWith(['2'])
  })

  it('チェックを外すと値が取り除かれる', async () => {
    const { onChange, user } = setup({ selected: ['1', '2'] })
    await user.click(screen.getByRole('button', { name: /2件選択/u }))
    await user.click(screen.getByLabelText('プロジェクトA'))
    expect(onChange).toHaveBeenCalledWith(['2'])
  })

  it('返す順序は options の並び順に揃える', async () => {
    const { onChange, user } = setup({ selected: ['3'] })
    await user.click(screen.getByRole('button', { name: /1件選択/u }))
    await user.click(screen.getByLabelText('プロジェクトA'))
    expect(onChange).toHaveBeenCalledWith(['1', '3'])
  })

  it('「表示中をすべて選択」で一括選択する', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole('button', { name: /未選択/u }))
    await user.click(screen.getByRole('button', { name: '表示中をすべて選択' }))
    expect(onChange).toHaveBeenCalledWith(['1', '2', '3'])
  })

  it('「クリア」で空にする', async () => {
    const { onChange, user } = setup({ selected: ['1'] })
    await user.click(screen.getByRole('button', { name: /1件選択/u }))
    await user.click(screen.getByRole('button', { name: 'クリア' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('searchable のとき絞り込める', async () => {
    const { user } = setup({ searchable: true })
    await user.click(screen.getByRole('button', { name: /未選択/u }))
    await user.type(screen.getByPlaceholderText('絞り込み'), 'プロジェクトA')

    expect(screen.getByLabelText('プロジェクトA')).toBeDefined()
    expect(screen.queryByLabelText('プロジェクトB')).toBeNull()
  })

  it('絞り込み結果が空なら「該当なし」を出す', async () => {
    const { user } = setup({ searchable: true })
    await user.click(screen.getByRole('button', { name: /未選択/u }))
    await user.type(screen.getByPlaceholderText('絞り込み'), 'zzz')
    expect(screen.getByText('該当なし')).toBeDefined()
  })

  it('絞り込み中の「表示中をすべて選択」は表示中のものだけを選ぶ', async () => {
    const { onChange, user } = setup({ searchable: true })
    await user.click(screen.getByRole('button', { name: /未選択/u }))
    await user.type(screen.getByPlaceholderText('絞り込み'), 'その他')
    await user.click(screen.getByRole('button', { name: '表示中をすべて選択' }))
    expect(onChange).toHaveBeenCalledWith(['3'])
  })

  it('絞り込んで Enter を押すと先頭の選択肢が選ばれる', async () => {
    const { onChange, user } = setup({ searchable: true })
    await user.click(screen.getByRole('button', { name: /未選択/u }))
    await user.type(screen.getByPlaceholderText('絞り込み'), 'プロジェクト')
    // 「プロジェクトA」「プロジェクトB」が残り、先頭は A。
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith(['1'])
  })

  it('Enter の対象がどれかを画面に出す', async () => {
    const { user } = setup({ searchable: true })
    await user.click(screen.getByRole('button', { name: /未選択/u }))
    await user.type(screen.getByPlaceholderText('絞り込み'), 'その他')
    expect(screen.getByText('Enter で「その他」を選択')).toBeDefined()
  })

  it('該当なしのときに Enter を押しても何も起きない', async () => {
    const { onChange, user } = setup({ searchable: true })
    await user.click(screen.getByRole('button', { name: /未選択/u }))
    await user.type(screen.getByPlaceholderText('絞り込み'), 'zzz')
    await user.keyboard('{Enter}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('選択済みの候補で Enter を押すと選択が外れる', async () => {
    const { onChange, user } = setup({ searchable: true, selected: ['1'] })
    await user.click(screen.getByRole('button', { name: /1件選択/u }))
    await user.type(screen.getByPlaceholderText('絞り込み'), 'プロジェクトA')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('Enter の対象が選択済みなら「解除」と出す', async () => {
    const { user } = setup({ searchable: true, selected: ['3'] })
    await user.click(screen.getByRole('button', { name: /1件選択/u }))
    await user.type(screen.getByPlaceholderText('絞り込み'), 'その他')
    expect(screen.getByText('Enter で「その他」を解除')).toBeDefined()
  })

  it('日本語入力の変換を確定する Enter では選択しない', async () => {
    const { onChange, user } = setup({ searchable: true })
    await user.click(screen.getByRole('button', { name: /未選択/u }))
    const search = screen.getByPlaceholderText('絞り込み')
    // IME の変換中に押された Enter は isComposing が立つ。
    fireEvent.keyDown(search, { key: 'Enter', isComposing: true })
    expect(onChange).not.toHaveBeenCalled()

    // 確定後の Enter は通常どおり効く。
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(['1'])
  })

  it('選択済みの選択肢を一覧の先頭に寄せる', async () => {
    const { user } = setup({ selected: ['3'] })
    await user.click(screen.getByRole('button', { name: /1件選択/u }))
    const labels = [...document.querySelectorAll('li')].map((item) => item.textContent)
    expect(labels).toEqual(['その他', 'プロジェクトA', 'プロジェクトB'])
  })

  it('先頭へ寄せても、選択済み同士・未選択同士の並びは変えない', async () => {
    const { user } = setup({ selected: ['2', '3'] })
    await user.click(screen.getByRole('button', { name: /2件選択/u }))
    const labels = [...document.querySelectorAll('li')].map((item) => item.textContent)
    expect(labels).toEqual(['プロジェクトB', 'その他', 'プロジェクトA'])
  })

  it('絞り込んでいなければ Enter は一覧の先頭を選ぶ', async () => {
    const { onChange, user } = setup({ searchable: true })
    await user.click(screen.getByRole('button', { name: /未選択/u }))
    await user.click(screen.getByPlaceholderText('絞り込み'))
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith(['1'])
  })

  it('Escape で閉じる', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: /未選択/u }))
    expect(screen.getByLabelText('プロジェクトA')).toBeDefined()

    await user.keyboard('{Escape}')
    expect(screen.queryByLabelText('プロジェクトA')).toBeNull()
  })

  it('外側をクリックすると閉じる', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: /未選択/u }))
    await user.click(document.body)
    expect(screen.queryByLabelText('プロジェクトA')).toBeNull()
  })

  it('開閉状態を aria-expanded に反映する', async () => {
    const { user } = setup()
    const trigger = screen.getByRole('button', { name: /未選択/u })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await user.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })
})
