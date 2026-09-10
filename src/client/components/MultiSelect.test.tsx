import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MultiSelect, type MultiSelectOption } from './MultiSelect'

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
    expect(screen.getByRole('button', { name: /未選択/ })).toBeDefined()
  })

  it('選択数を表示する', () => {
    setup({ selected: ['1', '2'] })
    expect(screen.getByRole('button', { name: /2件選択/ })).toBeDefined()
  })

  it('選択肢が無ければボタンを無効にする', () => {
    setup({ options: [] })
    const trigger = screen.getByRole('button', { name: /選択肢がありません/ }) as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
  })

  it('disabled を渡すとボタンが無効になる', () => {
    setup({ disabled: true })
    expect((screen.getByRole('button', { name: /未選択/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('クリックで開いて選択肢を表示する', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: /未選択/ }))
    expect(screen.getByLabelText('プロジェクトA')).toBeDefined()
    expect(screen.getByLabelText('プロジェクトB')).toBeDefined()
  })

  it('チェックすると値が追加される', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole('button', { name: /未選択/ }))
    await user.click(screen.getByLabelText('プロジェクトB'))
    expect(onChange).toHaveBeenCalledWith(['2'])
  })

  it('チェックを外すと値が取り除かれる', async () => {
    const { onChange, user } = setup({ selected: ['1', '2'] })
    await user.click(screen.getByRole('button', { name: /2件選択/ }))
    await user.click(screen.getByLabelText('プロジェクトA'))
    expect(onChange).toHaveBeenCalledWith(['2'])
  })

  it('返す順序は options の並び順に揃える', async () => {
    const { onChange, user } = setup({ selected: ['3'] })
    await user.click(screen.getByRole('button', { name: /1件選択/ }))
    await user.click(screen.getByLabelText('プロジェクトA'))
    expect(onChange).toHaveBeenCalledWith(['1', '3'])
  })

  it('「表示中をすべて選択」で一括選択する', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole('button', { name: /未選択/ }))
    await user.click(screen.getByRole('button', { name: '表示中をすべて選択' }))
    expect(onChange).toHaveBeenCalledWith(['1', '2', '3'])
  })

  it('「クリア」で空にする', async () => {
    const { onChange, user } = setup({ selected: ['1'] })
    await user.click(screen.getByRole('button', { name: /1件選択/ }))
    await user.click(screen.getByRole('button', { name: 'クリア' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('searchable のとき絞り込める', async () => {
    const { user } = setup({ searchable: true })
    await user.click(screen.getByRole('button', { name: /未選択/ }))
    await user.type(screen.getByPlaceholderText('絞り込み'), 'プロジェクトA')

    expect(screen.getByLabelText('プロジェクトA')).toBeDefined()
    expect(screen.queryByLabelText('プロジェクトB')).toBeNull()
  })

  it('絞り込み結果が空なら「該当なし」を出す', async () => {
    const { user } = setup({ searchable: true })
    await user.click(screen.getByRole('button', { name: /未選択/ }))
    await user.type(screen.getByPlaceholderText('絞り込み'), 'zzz')
    expect(screen.getByText('該当なし')).toBeDefined()
  })

  it('絞り込み中の「表示中をすべて選択」は表示中のものだけを選ぶ', async () => {
    const { onChange, user } = setup({ searchable: true })
    await user.click(screen.getByRole('button', { name: /未選択/ }))
    await user.type(screen.getByPlaceholderText('絞り込み'), 'その他')
    await user.click(screen.getByRole('button', { name: '表示中をすべて選択' }))
    expect(onChange).toHaveBeenCalledWith(['3'])
  })

  it('Escape で閉じる', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: /未選択/ }))
    expect(screen.getByLabelText('プロジェクトA')).toBeDefined()

    await user.keyboard('{Escape}')
    expect(screen.queryByLabelText('プロジェクトA')).toBeNull()
  })

  it('外側をクリックすると閉じる', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: /未選択/ }))
    await user.click(document.body)
    expect(screen.queryByLabelText('プロジェクトA')).toBeNull()
  })

  it('開閉状態を aria-expanded に反映する', async () => {
    const { user } = setup()
    const trigger = screen.getByRole('button', { name: /未選択/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await user.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })
})
