import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { defaultFilter } from '../shared/filter'
import type { GanttIssue } from '../shared/types'
import App from './app'
import { FilterBar } from './components/FilterBar'
import { GanttChart } from './components/GanttChart'
import { LoginPanel } from './components/LoginPanel'

/**
 * 初回レンダリングが例外を投げないことを確認する。
 * useEffect は走らないため、副作用ではなく描画ロジックの検証に絞っている。
 */

const NOW = Date.parse('2026-09-10T03:00:00Z')
const TODAY = '2026-09-10'

function makeIssue(overrides: Partial<GanttIssue> = {}): GanttIssue {
  return {
    id: 1,
    issueKey: 'PJA-1',
    summary: 'ログイン画面の改修',
    url: 'https://example.backlog.jp/view/PJA-1',
    projectId: 100,
    projectKey: 'PJA',
    assigneeId: 10,
    assigneeName: '山田太郎',
    statusId: 1,
    statusName: '未対応',
    statusColor: '#ed8077',
    isClosed: false,
    startDate: '2026-09-01',
    dueDate: '2026-09-15',
    estimatedHours: 8,
    actualHours: 3,
    parentIssueId: null,
    milestoneNames: ['v1.0'],
    ...overrides
  }
}

describe('LoginPanel', () => {
  it('初期表示でスペース入力欄とログインボタンを出す', () => {
    const html = renderToStaticMarkup(
      <LoginPanel initialSpace="" onSubmit={() => {}} submitting={false} error={null} />
    )
    expect(html).toContain('スペースドメイン')
    expect(html).toContain('Backlog でログイン')
  })

  it('エラーを表示する', () => {
    const html = renderToStaticMarkup(
      <LoginPanel initialSpace="" onSubmit={() => {}} submitting={false} error="認可の有効期限が切れました" />
    )
    expect(html).toContain('認可の有効期限が切れました')
  })
})

describe('FilterBar', () => {
  it('選択肢が空でも描画できる', () => {
    const html = renderToStaticMarkup(
      <FilterBar
        filter={defaultFilter(NOW)}
        onChange={() => {}}
        projects={[]}
        members={[]}
        statuses={[]}
        loading={false}
      />
    )
    expect(html).toContain('プロジェクト')
    expect(html).toContain('選択肢がありません')
  })

  it('プロジェクトの選択肢を出す', () => {
    const html = renderToStaticMarkup(
      <FilterBar
        filter={{ ...defaultFilter(NOW), projectIds: [100] }}
        onChange={() => {}}
        projects={[{ id: 100, projectKey: 'PJA', name: 'プロジェクトA' }]}
        members={[{ id: 10, name: '山田太郎' }]}
        statuses={[{ name: '未対応', color: '#ed8077', ids: [1], isClosed: false }]}
        loading={false}
      />
    )
    expect(html).toContain('1件選択')
  })
})

describe('GanttChart', () => {
  const filter = { ...defaultFilter(NOW), projectIds: [100] }

  it('課題が無いときは案内を出す', () => {
    const html = renderToStaticMarkup(<GanttChart issues={[]} filter={filter} today={TODAY} projectNames={{}} />)
    expect(html).toContain('表示できる課題がありません')
  })

  it('課題をバーとして描画する', () => {
    const html = renderToStaticMarkup(
      <GanttChart
        issues={[
          makeIssue(),
          makeIssue({
            id: 2,
            issueKey: 'PJB-2',
            url: 'https://example.backlog.jp/view/PJB-2',
            projectId: 200,
            projectKey: 'PJB',
            assigneeId: 20,
            assigneeName: '佐藤花子'
          })
        ]}
        filter={filter}
        today={TODAY}
        projectNames={{ 100: 'PJA プロジェクトA', 200: 'PJB プロジェクトB' }}
      />
    )
    expect(html).toContain('PJA-1')
    expect(html).toContain('PJB-2')
    expect(html).toContain('山田太郎')
    expect(html).toContain('佐藤花子')
    expect(html).toContain('gantt__bar')
  })

  it('遅延課題に警告のクラスを付ける', () => {
    const html = renderToStaticMarkup(
      <GanttChart issues={[makeIssue({ dueDate: '2026-09-05' })]} filter={filter} today={TODAY} projectNames={{}} />
    )
    expect(html).toContain('gantt__bar--overdue')
    expect(html).toContain('1件遅延')
  })

  it('日付未設定の課題は専用セクションにまとめる', () => {
    const html = renderToStaticMarkup(
      <GanttChart
        issues={[makeIssue({ startDate: null, dueDate: null })]}
        filter={{ ...filter, includeNoDate: true }}
        today={TODAY}
        projectNames={{}}
      />
    )
    expect(html).toContain('日付未設定の課題 1件')
  })

  it('グルーピング軸を切り替えても描画できる', () => {
    for (const groupBy of ['assignee', 'project', 'milestone'] as const) {
      const html = renderToStaticMarkup(
        <GanttChart issues={[makeIssue()]} filter={{ ...filter, groupBy }} today={TODAY} projectNames={{}} />
      )
      expect(html).toContain('PJA-1')
    }
  })

  it('ズームを切り替えても描画できる', () => {
    for (const zoom of ['day', 'week', 'month'] as const) {
      const html = renderToStaticMarkup(
        <GanttChart issues={[makeIssue()]} filter={{ ...filter, zoom }} today={TODAY} projectNames={{}} />
      )
      expect(html).toContain('gantt__bar')
    }
  })
})

describe('App', () => {
  it('セッション確認が終わるまでは読み込み中を表示する', () => {
    // renderToStaticMarkup では useEffect が走らないため、初期状態が描画される。
    const html = renderToStaticMarkup(<App />)
    expect(html).toContain('読み込み中')
  })
})
