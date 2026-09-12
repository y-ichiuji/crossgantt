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
    expect(screen.getByText(/取得 128 件/u)).toBeDefined()
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
    expect(screen.getByText(/件数が多いため一部のみ表示しています/u)).toBeDefined()
  })

  it('打ち切られていなければ警告を出さない', () => {
    setup()
    expect(screen.queryByText(/件数が多いため一部のみ表示しています/u)).toBeNull()
  })

  it('読み込み中は古い取得時刻を出さない', () => {
    setup({ loading: true, fetchedAt: '2026-09-10T03:04:05.000Z' })
    expect(screen.queryByText(/時点/u)).toBeNull()
    expect(screen.queryByText(/リクエスト/u)).toBeNull()
  })

  it('取得時刻とリクエスト数を表示する', () => {
    // 取得時刻はサーバーが UTC で作る。画面の日付はすべて JST で組み立てて
    // いるので、時刻だけ見る人のタイムゾーンに揃えると「今日」の列と食い違う。
    // 06:04 UTC = 15:04 JST。
    setup({ fetchedAt: '2026-09-10T06:04:00.000Z' })
    expect(screen.getByText(/15:04 時点/u)).toBeDefined()
    expect(screen.getByText(/Backlog API 30 リクエスト/u)).toBeDefined()
  })

  it('見る人のタイムゾーンによらず JST で出す', () => {
    // 日付をまたぐ時刻で確かめる。15:04 UTC は JST では翌日の 00:04。
    setup({ fetchedAt: '2026-09-10T15:04:00.000Z' })
    expect(screen.getByText(/00:04 時点/u)).toBeDefined()
  })

  it('取得時刻が無ければ何も出さない', () => {
    setup({ fetchedAt: null })
    expect(screen.queryByText(/時点/u)).toBeNull()
  })
})
