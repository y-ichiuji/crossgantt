import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { defaultFilter } from '../../shared/filter'
import { makeIssue, NOW, TODAY } from '../../shared/test-fixtures'
import type { GanttIssue, Holiday, ViewFilter } from '../../shared/types'
import { GanttChart } from './GanttChart'

const FILTER: ViewFilter = { ...defaultFilter(NOW), projectIds: [100] }

const OTHER_ISSUE = makeIssue({
  id: 2,
  issueKey: 'PJB-2',
  summary: 'API 設計',
  url: 'https://example.backlog.jp/view/PJB-2',
  projectId: 200,
  projectKey: 'PJB',
  assigneeId: 20,
  assigneeName: '佐藤花子'
})

// 2026 年 9 月は 21 日が敬老の日、22 日が国民の休日、23 日が秋分の日。
const HOLIDAYS: Holiday[] = [
  { dateKey: '2026-09-21', name: '敬老の日' },
  { dateKey: '2026-09-22', name: '国民の休日' },
  { dateKey: '2026-09-23', name: '秋分の日' }
]

function setup(issues: GanttIssue[], filter: Partial<ViewFilter> = {}, holidays: Holiday[] = HOLIDAYS) {
  render(
    <GanttChart
      issues={issues}
      filter={{ ...FILTER, ...filter }}
      today={TODAY}
      projectNames={{ 100: 'PJA プロジェクトA', 200: 'PJB プロジェクトB' }}
      holidays={holidays}
    />
  )
  return { user: userEvent.setup() }
}

describe('空の状態', () => {
  it('課題が無ければ案内を出す', () => {
    setup([])
    expect(screen.getByText('表示できる課題がありません。')).toBeDefined()
  })

  it('期間外の課題しか無ければ案内を出す', () => {
    setup([makeIssue({ startDate: '2020-01-01', dueDate: '2020-01-31' })])
    expect(screen.getByText('表示できる課題がありません。')).toBeDefined()
  })
})

describe('バーの描画', () => {
  it('課題キーと件名を行ヘッダーに出す', () => {
    setup([makeIssue()])
    expect(screen.getAllByText('PJA-1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('ログイン画面の改修').length).toBeGreaterThan(0)
  })

  it('バーから Backlog の課題へリンクする', () => {
    setup([makeIssue()])
    const bar = document.querySelector('[data-testid="gantt-bar"]')
    expect(bar?.getAttribute('href')).toBe('https://example.backlog.jp/view/PJA-1')
    expect(bar?.getAttribute('target')).toBe('_blank')
    expect(bar?.getAttribute('rel')).toContain('noreferrer')
  })

  it('バーに期間とステータスを含む aria-label を付ける', () => {
    setup([makeIssue()])
    expect(screen.getByLabelText('PJA-1 ログイン画面の改修（9/1〜9/15、未対応）')).toBeDefined()
  })

  it('バーの色はステータスの色にする', () => {
    setup([makeIssue({ statusColor: '#4488c5' })])
    const bar = document.querySelector('[data-testid="gantt-bar"]') as HTMLElement
    expect(bar.style.backgroundColor).toBe('#4488c5')
  })

  it('明るいステータス色の上では濃い文字にする', () => {
    setup([makeIssue({ statusColor: '#b0be3c' })])
    const bar = document.querySelector('[data-testid="gantt-bar"]') as HTMLElement
    expect(bar.style.color).toBe('#1c2430')
  })

  it('担当者のアイコンを行に表示する', () => {
    setup([makeIssue()])
    expect(document.querySelector('img')?.getAttribute('src')).toBe('/api/users/10/icon')
  })

  it('遅延している課題には遅延の印を付ける', () => {
    setup([makeIssue({ dueDate: '2026-09-05' })])
    expect(document.querySelector('[data-testid="gantt-bar"]')?.getAttribute('data-overdue')).toBe('true')
  })

  it('完了済みの課題には完了の印を付ける', () => {
    setup([makeIssue({ isClosed: true })])
    expect(document.querySelector('[data-testid="gantt-bar"]')?.getAttribute('data-closed')).toBe('true')
  })

  it('期限日だけの課題はマーカーとして描く', () => {
    setup([makeIssue({ startDate: null })])
    expect(document.querySelector('[data-testid="gantt-bar"]')?.getAttribute('data-kind')).toBe('due-marker')
  })

  it('開始日だけの課題は終端不明のバーとして描く', () => {
    setup([makeIssue({ dueDate: null })])
    expect(document.querySelector('[data-testid="gantt-bar"]')?.getAttribute('data-kind')).toBe('open-ended')
  })

  it('両方の日付がある課題は通常のバーとして描く', () => {
    setup([makeIssue()])
    expect(document.querySelector('[data-testid="gantt-bar"]')?.getAttribute('data-kind')).toBe('range')
  })

  it('表示期間からはみ出す課題は端を切り詰める', () => {
    setup([makeIssue({ startDate: '2020-01-01', dueDate: '2030-12-31' })])
    const bar = document.querySelector('[data-testid="gantt-bar"]')
    expect(bar?.getAttribute('data-clip-start')).toBe('true')
    expect(bar?.getAttribute('data-clip-end')).toBe('true')
  })
})

describe('グルーピング', () => {
  it('担当者別にまとめて件数を出す', () => {
    setup([makeIssue(), OTHER_ISSUE], { groupBy: 'assignee' })
    expect(screen.getByRole('button', { name: /山田太郎/u })).toBeDefined()
    expect(screen.getByRole('button', { name: /佐藤花子/u })).toBeDefined()
  })

  it('既定ではプロジェクト別にまとめる', () => {
    setup([makeIssue(), OTHER_ISSUE])
    expect(screen.getByRole('button', { name: /PJA プロジェクトA/u })).toBeDefined()
    expect(screen.getByRole('button', { name: /PJB プロジェクトB/u })).toBeDefined()
  })

  it('プロジェクト別にまとめる', () => {
    setup([makeIssue(), OTHER_ISSUE], { groupBy: 'project' })
    expect(screen.getByRole('button', { name: /PJA プロジェクトA/u })).toBeDefined()
    expect(screen.getByRole('button', { name: /PJB プロジェクトB/u })).toBeDefined()
  })

  it('マイルストーン別にまとめる', () => {
    setup([makeIssue({ milestoneNames: ['v1.0'] }), makeIssue({ id: 3, milestoneNames: [] })], {
      groupBy: 'milestone'
    })
    expect(screen.getByRole('button', { name: /v1\.0/u })).toBeDefined()
    expect(screen.getByRole('button', { name: /マイルストーンなし/u })).toBeDefined()
  })

  it('遅延件数をバッジで示す', () => {
    setup([makeIssue({ dueDate: '2026-09-05' })], { groupBy: 'assignee' })
    const group = screen.getByRole('button', { name: /山田太郎/u })
    expect(within(group).getByText('1件遅延')).toBeDefined()
  })

  it('担当者別のときは見出しにアイコンを出す', () => {
    setup([makeIssue()], { groupBy: 'assignee' })
    const group = screen.getByRole('button', { name: /山田太郎/u })
    expect(group.querySelector('img')?.getAttribute('src')).toBe('/api/users/10/icon')
  })

  it('プロジェクト別のときは見出しにアイコンを出さない', () => {
    setup([makeIssue()], { groupBy: 'project' })
    const group = screen.getByRole('button', { name: /PJA/u })
    expect(group.querySelector('img')).toBeNull()
  })

  it('グループを折りたたむと課題行が消える', async () => {
    const { user } = setup([makeIssue()], { groupBy: 'assignee' })
    expect(document.querySelectorAll('[data-testid="gantt-bar"]')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /山田太郎/u }))
    expect(document.querySelectorAll('[data-testid="gantt-bar"]')).toHaveLength(0)
  })

  it('もう一度押すと開く', async () => {
    const { user } = setup([makeIssue()], { groupBy: 'assignee' })
    const toggle = screen.getByRole('button', { name: /山田太郎/u })
    await user.click(toggle)
    await user.click(toggle)
    expect(document.querySelectorAll('[data-testid="gantt-bar"]')).toHaveLength(1)
  })
})

describe('目盛りと今日の列', () => {
  it('月の見出しを出す', () => {
    setup([makeIssue()])
    expect(screen.getByText('2026年9月')).toBeDefined()
  })

  it('表示期間に今日が含まれていれば今日の列を塗る', () => {
    setup([makeIssue()], { zoom: 'day' })
    const column = document.querySelector('[data-testid="today-column"]')
    expect(column).not.toBeNull()
    // 線ではなく 1 日分の幅を持つ列であることを確かめる。
    expect(column?.getAttribute('style')).toContain('width: 30px')
  })

  it('表示期間に今日が含まれなければ今日の列を塗らない', () => {
    setup([makeIssue({ startDate: '2027-01-05', dueDate: '2027-01-20' })], {
      from: '2027-01-01',
      to: '2027-01-31'
    })
    expect(document.querySelector('[data-testid="today-column"]')).toBeNull()
  })

  it('今日の列は課題名カラムより奥の背景レイヤーに置く', () => {
    setup([makeIssue()])
    const column = document.querySelector('[data-testid="today-column"]')
    const weekend = document.querySelector('[data-testid="weekend-band"]')
    // 横スクロールで課題名に重ならないよう、土日と同じ背景レイヤーの子にする。
    expect(weekend).not.toBeNull()
    expect(column?.parentElement).toBe(weekend?.parentElement)
  })

  const SEPTEMBER = { from: '2026-09-01', to: '2026-09-30' } as const

  it('日ズームでは祝日に帯を出す', () => {
    setup([makeIssue()], { ...SEPTEMBER, zoom: 'day' })
    expect(document.querySelectorAll('[data-testid="holiday-band"]')).toHaveLength(3)
  })

  it('週ズームでは祝日の帯を出さない', () => {
    setup([makeIssue()], { ...SEPTEMBER, zoom: 'week' })
    expect(document.querySelectorAll('[data-testid="holiday-band"]')).toHaveLength(0)
  })

  it('祝日の目盛りに名称を出す', () => {
    setup([makeIssue()], { ...SEPTEMBER, zoom: 'day' })
    const marked = [...document.querySelectorAll('[data-holiday="true"]')]
    expect(marked.map((tick) => tick.getAttribute('title'))).toEqual(['敬老の日', '国民の休日', '秋分の日'])
  })

  it('祝日を取得できていなければ帯を出さない', () => {
    setup([makeIssue()], { ...SEPTEMBER, zoom: 'day' }, [])
    expect(document.querySelectorAll('[data-testid="holiday-band"]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-holiday="true"]')).toHaveLength(0)
  })

  it('ヘッダーの目盛りでも今日を示す', () => {
    setup([makeIssue()], { zoom: 'day' })
    expect(document.querySelectorAll('[data-today="true"]')).toHaveLength(1)
  })

  it('日ズームでは 1 日ごとの罫線幅を渡す', () => {
    setup([makeIssue()], { zoom: 'day' })
    const scroller = document.querySelector('[data-testid="gantt-scroller"]')
    expect(scroller?.getAttribute('style')).toContain('--grid-step: 30px')
  })

  it('週ズームでは 1 週ごとの罫線幅を渡す', () => {
    setup([makeIssue()], { zoom: 'week' })
    const scroller = document.querySelector('[data-testid="gantt-scroller"]')
    expect(scroller?.getAttribute('style')).toContain('--grid-step: 84px')
  })

  it('日ズームでは土日に帯を出す', () => {
    setup([makeIssue()], { zoom: 'day' })
    expect(document.querySelectorAll('[data-testid="weekend-band"]').length).toBeGreaterThan(0)
  })

  it('週ズームでは土日の帯を出さない', () => {
    setup([makeIssue()], { zoom: 'week' })
    expect(document.querySelectorAll('[data-testid="weekend-band"]')).toHaveLength(0)
  })
})

describe('ツールチップ', () => {
  it('バーにホバーすると詳細が出る', async () => {
    const { user } = setup([makeIssue()])
    await user.hover(screen.getByLabelText('PJA-1 ログイン画面の改修（9/1〜9/15、未対応）'))
    expect(screen.getByRole('tooltip')).toBeDefined()
    expect(within(screen.getByRole('tooltip')).getByText('9/1 〜 9/15')).toBeDefined()
  })

  it('離れると消える', async () => {
    const { user } = setup([makeIssue()])
    const bar = screen.getByLabelText('PJA-1 ログイン画面の改修（9/1〜9/15、未対応）')
    await user.hover(bar)
    await user.unhover(bar)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('キーボードフォーカスでも出る', async () => {
    const { user } = setup([makeIssue()])
    await user.tab()
    await user.tab()
    await user.tab()
    expect(screen.getByRole('tooltip')).toBeDefined()
  })
})

describe('日付未設定セクション', () => {
  it('includeNoDate が有効なら件数を出す', () => {
    setup([makeIssue({ startDate: null, dueDate: null })], { includeNoDate: true })
    expect(screen.getByRole('button', { name: /日付未設定の課題 1件/u })).toBeDefined()
  })

  it('includeNoDate が無効なら出さない', () => {
    setup([makeIssue(), makeIssue({ id: 5, startDate: null, dueDate: null })], { includeNoDate: false })
    expect(screen.queryByRole('button', { name: /日付未設定の課題/u })).toBeNull()
  })

  it('開くと課題の一覧を出す', async () => {
    const { user } = setup([makeIssue({ startDate: null, dueDate: null })], { includeNoDate: true })
    await user.click(screen.getByRole('button', { name: /日付未設定の課題 1件/u }))
    expect(screen.getByRole('link', { name: /PJA-1/u })).toBeDefined()
    expect(screen.getByText(/PJA プロジェクトA \/ 山田太郎 \/ 未対応/u)).toBeDefined()
  })
})
