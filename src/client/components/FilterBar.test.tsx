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
    expect(screen.getAllByRole('button', { name: /選択肢がありません/u }).length).toBeGreaterThan(0)
  })

  it('プロジェクトを選ぶと数値の配列で通知する', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole('button', { name: 'プロジェクト 未選択' }))
    await user.click(screen.getByLabelText('PJA プロジェクトA'))
    expect(onChange).toHaveBeenCalledWith({ projectIds: [100] })
  })

  it('担当者も数値の配列で通知する', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole('button', { name: '担当者 すべて' }))
    await user.click(screen.getByLabelText('佐藤花子'))
    expect(onChange).toHaveBeenCalledWith({ assigneeIds: [20] })
  })

  it('ステータスは名前の配列で通知する', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole('button', { name: 'ステータス 完了以外すべて' }))
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

  it('大項目の変更を通知する', async () => {
    const { onChange, user } = setup()
    await user.selectOptions(screen.getByLabelText('大項目'), 'assignee')
    expect(onChange).toHaveBeenCalledWith({ groupBy: ['assignee'] })
  })

  it('中項目を選ぶと 2 段になる', async () => {
    const { onChange, user } = setup()
    await user.selectOptions(screen.getByLabelText('中項目'), 'category')
    expect(onChange).toHaveBeenCalledWith({ groupBy: ['project', 'category'] })
  })

  it('大項目には「なし」を出さない', () => {
    setup()
    const options = screen.getByLabelText('大項目').querySelectorAll('option')
    expect([...options].map((option) => option.textContent)).not.toContain('なし')
  })

  it('上の段で使った軸は下の段の選択肢に出さない', () => {
    setup({ filter: { ...defaultFilter(NOW), groupBy: ['project'] } })
    const options = screen.getByLabelText('中項目').querySelectorAll('option')
    expect([...options].map((option) => option.textContent)).not.toContain('プロジェクト別')
  })

  it('中項目が未選択なら小項目は操作できない', () => {
    setup({ filter: { ...defaultFilter(NOW), groupBy: ['project'] } })
    expect((screen.getByLabelText('小項目') as HTMLSelectElement).disabled).toBe(true)
  })

  it('中項目を「なし」にすると小項目もまとめて落ちる', async () => {
    const { onChange, user } = setup({
      filter: { ...defaultFilter(NOW), groupBy: ['project', 'category', 'assignee'] }
    })
    await user.selectOptions(screen.getByLabelText('中項目'), '')
    expect(onChange).toHaveBeenCalledWith({ groupBy: ['project'] })
  })

  it('下の段で使っていた軸を上の段に選ぶと下からは外れる', async () => {
    const { onChange, user } = setup({
      filter: { ...defaultFilter(NOW), groupBy: ['project', 'category', 'assignee'] }
    })
    await user.selectOptions(screen.getByLabelText('大項目'), 'category')
    expect(onChange).toHaveBeenCalledWith({ groupBy: ['category', 'assignee'] })
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
    expect((screen.getByRole('button', { name: '担当者 すべて' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'ステータス 完了以外すべて' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('読み込み中でもプロジェクトは変更できる', () => {
    setup({ loading: true })
    expect((screen.getByRole('button', { name: 'プロジェクト 未選択' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
