/**
 * テスト用のダミーデータ。実装からは参照されない。
 */

import type { GanttIssue, MemberSummary, ProjectSummary, StatusGroup } from './types'

/** テストで基準に使う「今日」。 */
export const TODAY = '2026-09-10'

/** テストで基準に使う現在時刻（JST の 2026-09-10 12:00）。 */
export const NOW = Date.parse('2026-09-10T03:00:00Z')

export function makeIssue(overrides: Partial<GanttIssue> = {}): GanttIssue {
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

export const PROJECTS: ProjectSummary[] = [
  { id: 100, projectKey: 'PJA', name: 'プロジェクトA' },
  { id: 200, projectKey: 'PJB', name: 'プロジェクトB' }
]

export const MEMBERS: MemberSummary[] = [
  { id: 10, name: '山田太郎' },
  { id: 20, name: '佐藤花子' }
]

export const STATUSES: StatusGroup[] = [
  { name: '未対応', color: '#ed8077', ids: [1], isClosed: false },
  { name: '処理中', color: '#4488c5', ids: [2], isClosed: false },
  { name: '完了', color: '#b0be3c', ids: [4], isClosed: true }
]
