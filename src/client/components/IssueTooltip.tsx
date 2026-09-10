import { formatShort } from '../../shared/date'
import type { GanttIssue } from '../../shared/types'

export type TooltipState = {
  issue: GanttIssue
  x: number
  y: number
  overdue: boolean
}

/** ツールチップがビューポートからはみ出さないようにするための余白。 */
const MARGIN = 16
const WIDTH = 320

/** バーにホバーしたときに表示する課題の詳細。 */
export function IssueTooltip({ state }: { state: TooltipState }) {
  const { issue, overdue } = state
  const viewportWidth = typeof window === 'undefined' ? WIDTH + MARGIN * 2 : window.innerWidth
  const left = Math.min(state.x + MARGIN, Math.max(MARGIN, viewportWidth - WIDTH - MARGIN))
  const top = state.y + MARGIN

  const period =
    issue.startDate && issue.dueDate
      ? `${formatShort(issue.startDate)} 〜 ${formatShort(issue.dueDate)}`
      : issue.dueDate
        ? `期限 ${formatShort(issue.dueDate)}`
        : issue.startDate
          ? `${formatShort(issue.startDate)} 〜 (期限未設定)`
          : '日付未設定'

  return (
    <div className="tooltip" style={{ left, top, width: WIDTH }} role="tooltip">
      <div className="tooltip__key">{issue.issueKey}</div>
      <div className="tooltip__summary">{issue.summary}</div>
      <dl className="tooltip__meta">
        <dt>期間</dt>
        <dd className={overdue ? 'is-overdue' : undefined}>
          {period}
          {overdue ? '（遅延）' : ''}
        </dd>
        <dt>担当</dt>
        <dd>{issue.assigneeName ?? '未割り当て'}</dd>
        <dt>状態</dt>
        <dd>{issue.statusName}</dd>
        <dt>工数</dt>
        <dd>
          予定 {issue.estimatedHours ?? '—'} / 実績 {issue.actualHours ?? '—'}
        </dd>
        {issue.milestoneNames.length > 0 ? (
          <>
            <dt>マイルストーン</dt>
            <dd>{issue.milestoneNames.join(', ')}</dd>
          </>
        ) : null}
      </dl>
    </div>
  )
}
