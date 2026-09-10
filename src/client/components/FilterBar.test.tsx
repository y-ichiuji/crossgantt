import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { defaultFilter } from '../../shared/filter'
import { MEMBERS, NOW, PROJECTS, STATUSES } from '../../shared/test-fixtures'
import { FilterBar } from './FilterBar'

function setup(props: Partial<React.ComponentProps<typeof FilterBar>> = {}) {
  const onChange = vi.fn()
  render(
    <FilterBar
      filter={defaultFilter(NOW)}
      onChange={onChange}
      projects={PROJECTS}
      members={MEMBERS}
      statuses={STATUSES}
      loading={false}
      {...props}
    />
  )
  return { onChange, user: userEvent.setup() }
}

describe('FilterBar', () => {
  it('主要なフィルタを表示する', () => {
    setup()
    expect(screen.getByText('プロジェクト')).toBeDefined()
    expect(screen.getByText('担当者')).toBeDefined()
    expect(screen.getByText('ステータス')).toBeDefined()
    expect(screen.getByLabelText('開始')).toBeDefined()
    expect(screen.getByLabelText('終了')).toBeDefined()
  })

  it('選択肢が空でも壊れない', () => {
    setup({ projects: [], members: [], statuses: [] })
    expect(screen.getAllByRole('button', { name: /選択肢がありません/ }).length).toBeGreaterThan(0)
  })

  it('プロジェクトを選ぶと数値の配列で通知する', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole('button', { name: '未選択' }))
    await user.click(screen.getByLabelText('PJA プロジェクトA'))
    expect(onChange).toHaveBeenCalledWith({ projectIds: [100] })
  })

  it('担当者も数値の配列で通知する', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole('button', { name: 'すべて' }))
    await user.click(screen.getByLabelText('佐藤花子'))
    expect(onChange).toHaveBeenCalledWith({ assigneeIds: [20] })
  })

  it('ステータスは名前の配列で通知する', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole('button', { name: '完了以外すべて' }))
    await user.click(screen.getByLabelText('処理中'))
    expect(onChange).toHaveBeenCalledWith({ statusNames: ['処理中'] })
  })

  it('開始日の変更を通知する', () => {
    const { onChange } = setup()
    fireEvent.change(screen.getByLabelText('開始'), { target: { value: '2026-10-01' } })
    expect(onChange).toHaveBeenCalledWith({ from: '2026-10-01' })
  })

  it('終了日の変更を通知する', () => {
    const { onChange } = setup()
    fireEvent.change(screen.getByLabelText('終了'), { target: { value: '2026-11-30' } })
    expect(onChange).toHaveBeenCalledWith({ to: '2026-11-30' })
  })

  it('グルーピングの変更を通知する', async () => {
    const { onChange, user } = setup()
    await user.selectOptions(screen.getByLabelText('グルーピング'), 'project')
    expect(onChange).toHaveBeenCalledWith({ groupBy: 'project' })
  })

  it('ズームの変更を通知する', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole('button', { name: '日' }))
    expect(onChange).toHaveBeenCalledWith({ zoom: 'day' })
  })

  it('現在のズームを aria-pressed で示す', () => {
    setup({ filter: { ...defaultFilter(NOW), zoom: 'month' } })
    expect(screen.getByRole('button', { name: '月' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '日' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('キーワードの変更を通知する', async () => {
    const { onChange, user } = setup()
    await user.type(screen.getByLabelText('キーワード'), 'A')
    expect(onChange).toHaveBeenCalledWith({ keyword: 'A' })
  })

  it('「完了を含む」を切り替えられる', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByLabelText('完了を含む'))
    expect(onChange).toHaveBeenCalledWith({ includeClosed: true })
  })

  it('「日付未設定を含む」を切り替えられる', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByLabelText('日付未設定を含む'))
    expect(onChange).toHaveBeenCalledWith({ includeNoDate: true })
  })

  it('読み込み中は担当者とステータスの操作を無効にする', () => {
    setup({ loading: true })
    expect((screen.getByRole('button', { name: 'すべて' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '完了以外すべて' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('読み込み中でもプロジェクトは変更できる', () => {
    setup({ loading: true })
    expect((screen.getByRole('button', { name: '未選択' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
