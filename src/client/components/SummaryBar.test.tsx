import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { GanttSummary } from '../../shared/gantt'
import { SummaryBar } from './SummaryBar'

const SUMMARY: GanttSummary = { total: 128, overdue: 7, noDate: 12, inRange: 100 }

function setup(props: Partial<React.ComponentProps<typeof SummaryBar>> = {}) {
  render(
    <SummaryBar summary={SUMMARY} truncated={false} requestCount={30} fetchedAt={null} loading={false} {...props} />
  )
}

describe('SummaryBar', () => {
  it('件数を表示する', () => {
    setup()
    expect(screen.getByText('100').textContent).toBe('100')
    expect(screen.getByText('7')).toBeDefined()
    expect(screen.getByText('12')).toBeDefined()
    expect(screen.getByText(/取得 128 件/)).toBeDefined()
  })

  it('遅延があれば強調の印を付ける', () => {
    setup()
    expect(screen.getByText('7').closest('span')?.getAttribute('data-overdue')).toBe('true')
  })

  it('遅延が 0 なら強調しない', () => {
    setup({ summary: { ...SUMMARY, overdue: 0 } })
    expect(screen.getByText('0').closest('span')?.getAttribute('data-overdue')).toBe('false')
  })

  it('打ち切られた場合は警告を出す', () => {
    setup({ truncated: true })
    expect(screen.getByText(/件数が多いため一部のみ表示しています/)).toBeDefined()
  })

  it('打ち切られていなければ警告を出さない', () => {
    setup()
    expect(screen.queryByText(/件数が多いため一部のみ表示しています/)).toBeNull()
  })

  it('読み込み中は「読み込み中…」を出す', () => {
    setup({ loading: true, fetchedAt: '2026-09-10T03:04:05.000Z' })
    expect(screen.getByText('読み込み中…')).toBeDefined()
    expect(screen.queryByText(/リクエスト/)).toBeNull()
  })

  it('取得時刻とリクエスト数を表示する', () => {
    const date = new Date(2026, 8, 10, 15, 4)
    setup({ fetchedAt: date.toISOString() })
    expect(screen.getByText(/15:04 時点/)).toBeDefined()
    expect(screen.getByText(/Backlog API 30 リクエスト/)).toBeDefined()
  })

  it('取得時刻が無ければ何も出さない', () => {
    setup({ fetchedAt: null })
    expect(screen.queryByText(/時点/)).toBeNull()
  })
})
