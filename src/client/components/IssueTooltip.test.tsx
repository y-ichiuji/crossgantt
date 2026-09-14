import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { makeIssue } from '../../shared/test-fixtures'
import { IssueTooltip } from './IssueTooltip'
import type { TooltipState } from './IssueTooltip'

function state(overrides: Partial<TooltipState> = {}): TooltipState {
  return { issue: makeIssue(), x: 100, y: 200, overdue: false, ...overrides }
}

describe('IssueTooltip', () => {
  // innerWidth / innerHeight を差し替えたまま返すと、以降のテストが 1600px の環境を
  // 前提に動いてしまい、実行順に依存した不安定な結果になる。必ず戻す。
  const originals = new Map(
    (['innerWidth', 'innerHeight'] as const).map((name) => [name, Object.getOwnPropertyDescriptor(window, name)])
  )
  afterEach(() => {
    for (const [name, descriptor] of originals) {
      if (descriptor) {
        Object.defineProperty(window, name, descriptor)
      } else {
        Reflect.deleteProperty(window, name)
      }
    }
  })

  it('課題キーと件名を表示する', () => {
    render(<IssueTooltip state={state()} />)
    expect(screen.getByText('PJA-1')).toBeDefined()
    expect(screen.getByText('ログイン画面の改修')).toBeDefined()
  })

  it('開始日と期限日があれば期間として表示する', () => {
    render(<IssueTooltip state={state()} />)
    expect(screen.getByText('9/1 〜 9/15')).toBeDefined()
  })

  it('期限日のみなら「期限」として表示する', () => {
    render(<IssueTooltip state={state({ issue: makeIssue({ startDate: null }) })} />)
    expect(screen.getByText('期限 9/15')).toBeDefined()
  })

  it('開始日のみなら期限未設定と表示する', () => {
    render(<IssueTooltip state={state({ issue: makeIssue({ dueDate: null }) })} />)
    expect(screen.getByText('9/1 〜 (期限未設定)')).toBeDefined()
  })

  it('どちらも無ければ日付未設定と表示する', () => {
    render(<IssueTooltip state={state({ issue: makeIssue({ startDate: null, dueDate: null }) })} />)
    expect(screen.getByText('日付未設定')).toBeDefined()
  })

  it('遅延なら期間に印を付ける', () => {
    render(<IssueTooltip state={state({ overdue: true })} />)
    expect(screen.getByText(/（遅延）/u).getAttribute('data-overdue')).toBe('true')
  })

  it('担当者・状態・工数を表示する', () => {
    render(<IssueTooltip state={state()} />)
    expect(screen.getByText('山田太郎')).toBeDefined()
    expect(screen.getByText('未対応')).toBeDefined()
    expect(screen.getByText('予定 8 / 実績 3')).toBeDefined()
  })

  it('担当者が未設定なら「未割り当て」と出す', () => {
    render(<IssueTooltip state={state({ issue: makeIssue({ assigneeId: null, assigneeName: null }) })} />)
    expect(screen.getByText('未割り当て')).toBeDefined()
  })

  it('工数が未設定ならダッシュで埋める', () => {
    render(<IssueTooltip state={state({ issue: makeIssue({ estimatedHours: null, actualHours: null }) })} />)
    expect(screen.getByText('予定 — / 実績 —')).toBeDefined()
  })

  it('カテゴリがあれば列挙する', () => {
    render(<IssueTooltip state={state({ issue: makeIssue({ categoryNames: ['設計', '実装'] }) })} />)
    expect(screen.getByText('設計, 実装')).toBeDefined()
  })

  it('カテゴリが無ければ行ごと出さない', () => {
    render(<IssueTooltip state={state({ issue: makeIssue({ categoryNames: [] }) })} />)
    expect(screen.queryByText('カテゴリ')).toBeNull()
  })

  it('マイルストーンがあれば列挙する', () => {
    render(<IssueTooltip state={state({ issue: makeIssue({ milestoneNames: ['v1.0', 'v1.1'] }) })} />)
    expect(screen.getByText('v1.0, v1.1')).toBeDefined()
  })

  it('マイルストーンが無ければ行ごと出さない', () => {
    render(<IssueTooltip state={state({ issue: makeIssue({ milestoneNames: [] }) })} />)
    expect(screen.queryByText('マイルストーン')).toBeNull()
  })

  it('ビューポートの右端からはみ出さない', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })
    render(<IssueTooltip state={state({ x: 390 })} />)
    // 幅 320 と余白 16 を確保できる最大の左端（400 - 320 - 16 = 64）まで押し戻される。
    expect(screen.getByRole('tooltip').style.left).toBe('64px')
  })

  it('ビューポートが幅より狭くても左余白は確保する', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 300 })
    render(<IssueTooltip state={state({ x: 250 })} />)
    expect(screen.getByRole('tooltip').style.left).toBe('16px')
  })

  it('ビューポートの下端からはみ出さない', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
    render(<IssueTooltip state={state({ y: 590 })} />)
    // 画面はページごとスクロールしないため、下端より下へ出すと読めなくなる。
    // 見積もり高さ 220 と余白 16 を確保できる最大の上端（600 - 220 - 16 = 364）まで押し戻す。
    expect(screen.getByRole('tooltip').style.top).toBe('364px')
  })

  it('ビューポートが見積もり高さより低くても上余白は確保する', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 200 })
    render(<IssueTooltip state={state({ y: 150 })} />)
    expect(screen.getByRole('tooltip').style.top).toBe('16px')
  })

  it('余裕があればカーソルの右下に出す', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1200 })
    render(<IssueTooltip state={state({ x: 100, y: 200 })} />)
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.style.left).toBe('116px')
    expect(tooltip.style.top).toBe('216px')
  })
})
