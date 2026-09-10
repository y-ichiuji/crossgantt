import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { defaultFilter } from '../../shared/filter'
import { makeIssue, NOW, TODAY } from '../../shared/test-fixtures'
import type { GanttIssue, ViewFilter } from '../../shared/types'
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

function setup(issues: GanttIssue[], filter: Partial<ViewFilter> = {}) {
  render(
    <GanttChart
      issues={issues}
      filter={{ ...FILTER, ...filter }}
      today={TODAY}
      projectNames={{ 100: 'PJA プロジェクトA', 200: 'PJB プロジェクトB' }}
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
    const links = screen.getAllByRole('link', { name: /PJA-1/ })
    const bar = links.find((link) => link.className.includes('gantt__bar'))
    expect(bar?.getAttribute('href')).toBe('https://example.backlog.jp/view/PJA-1')
    expect(bar?.getAttribute('target')).toBe('_blank')
    expect(bar?.getAttribute('rel')).toContain('noreferrer')
  })

  it('バーに期間とステータスを含む aria-label を付ける', () => {
    setup([makeIssue()])
    expect(screen.getByLabelText('PJA-1 ログイン画面の改修（9/1〜9/15、未対応）')).toBeDefined()
  })

  it('遅延している課題には警告のクラスを付ける', () => {
    setup([makeIssue({ dueDate: '2026-09-05' })])
    const bar = document.querySelector('.gantt__bar')
    expect(bar?.className).toContain('gantt__bar--overdue')
  })

  it('完了済みの課題は淡く表示する', () => {
    setup([makeIssue({ isClosed: true })])
    expect(document.querySelector('.gantt__bar')?.className).toContain('gantt__bar--closed')
  })

  it('期限日だけの課題はマーカーとして描く', () => {
    setup([makeIssue({ startDate: null })])
    expect(document.querySelector('.gantt__bar')?.className).toContain('gantt__bar--due-marker')
  })

  it('開始日だけの課題は終端不明のバーとして描く', () => {
    setup([makeIssue({ dueDate: null })])
    expect(document.querySelector('.gantt__bar')?.className).toContain('gantt__bar--open-ended')
  })

  it('表示期間からはみ出す課題は端を切り詰める', () => {
    setup([makeIssue({ startDate: '2020-01-01', dueDate: '2030-12-31' })])
    const bar = document.querySelector('.gantt__bar')
    expect(bar?.className).toContain('gantt__bar--clip-start')
    expect(bar?.className).toContain('gantt__bar--clip-end')
  })
})

describe('グルーピング', () => {
  it('担当者別にまとめて件数を出す', () => {
    setup([makeIssue(), OTHER_ISSUE])
    expect(screen.getByRole('button', { name: /山田太郎/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /佐藤花子/ })).toBeDefined()
  })

  it('プロジェクト別にまとめる', () => {
    setup([makeIssue(), OTHER_ISSUE], { groupBy: 'project' })
    expect(screen.getByRole('button', { name: /PJA プロジェクトA/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /PJB プロジェクトB/ })).toBeDefined()
  })

  it('マイルストーン別にまとめる', () => {
    setup([makeIssue({ milestoneNames: ['v1.0'] }), makeIssue({ id: 3, milestoneNames: [] })], {
      groupBy: 'milestone'
    })
    expect(screen.getByRole('button', { name: /v1\.0/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /マイルストーンなし/ })).toBeDefined()
  })

  it('遅延件数をバッジで示す', () => {
    setup([makeIssue({ dueDate: '2026-09-05' })])
    const group = screen.getByRole('button', { name: /山田太郎/ })
    expect(within(group).getByText('1件遅延')).toBeDefined()
  })

  it('グループを折りたたむと課題行が消える', async () => {
    const { user } = setup([makeIssue()])
    expect(document.querySelectorAll('.gantt__bar')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /山田太郎/ }))
    expect(document.querySelectorAll('.gantt__bar')).toHaveLength(0)
  })

  it('もう一度押すと開く', async () => {
    const { user } = setup([makeIssue()])
    const toggle = screen.getByRole('button', { name: /山田太郎/ })
    await user.click(toggle)
    await user.click(toggle)
    expect(document.querySelectorAll('.gantt__bar')).toHaveLength(1)
  })
})

describe('目盛りと今日線', () => {
  it('月の見出しを出す', () => {
    setup([makeIssue()])
    expect(screen.getByText('2026年9月')).toBeDefined()
  })

  it('表示期間に今日が含まれていれば今日線を引く', () => {
    setup([makeIssue()])
    expect(document.querySelector('.gantt__today')).not.toBeNull()
  })

  it('表示期間に今日が含まれなければ今日線を引かない', () => {
    setup([makeIssue({ startDate: '2027-01-05', dueDate: '2027-01-20' })], {
      from: '2027-01-01',
      to: '2027-01-31'
    })
    expect(document.querySelector('.gantt__today')).toBeNull()
  })

  it('日ズームでは土日に帯を出す', () => {
    setup([makeIssue()], { zoom: 'day' })
    expect(document.querySelectorAll('.gantt__weekend').length).toBeGreaterThan(0)
  })

  it('週ズームでは土日の帯を出さない', () => {
    setup([makeIssue()], { zoom: 'week' })
    expect(document.querySelectorAll('.gantt__weekend')).toHaveLength(0)
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
    expect(screen.queryByRole('tooltip')).not.toBeNull()
  })
})

describe('日付未設定セクション', () => {
  it('includeNoDate が有効なら件数を出す', () => {
    setup([makeIssue({ startDate: null, dueDate: null })], { includeNoDate: true })
    expect(screen.getByRole('button', { name: /日付未設定の課題 1件/ })).toBeDefined()
  })

  it('includeNoDate が無効なら出さない', () => {
    setup([makeIssue(), makeIssue({ id: 5, startDate: null, dueDate: null })], { includeNoDate: false })
    expect(screen.queryByRole('button', { name: /日付未設定の課題/ })).toBeNull()
  })

  it('開くと課題の一覧を出す', async () => {
    const { user } = setup([makeIssue({ startDate: null, dueDate: null })], { includeNoDate: true })
    await user.click(screen.getByRole('button', { name: /日付未設定の課題 1件/ }))
    expect(screen.getByRole('link', { name: /PJA-1/ })).toBeDefined()
    expect(screen.getByText(/PJA プロジェクトA \/ 山田太郎 \/ 未対応/)).toBeDefined()
  })
})
