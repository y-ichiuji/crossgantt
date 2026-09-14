import { formatShort } from '../../shared/date'
import type { GanttIssue } from '../../shared/types'

import styles from './IssueTooltip.module.css'

export type TooltipState = {
  issue: GanttIssue
  x: number
  y: number
  overdue: boolean
}

/** ツールチップがビューポートからはみ出さないようにするための余白。 */
const MARGIN = 16
const WIDTH = 320

/**
 * 縦方向の押し戻しに使う高さの見積もり。
 *
 * 実際の高さは件名の折り返しやカテゴリ・マイルストーンの有無で変わるが、
 * 測るには描画してから位置を決め直すことになり、ホバーのたびに再レンダリングが
 * 増える。多めに見積もっておけば、外れても下端からはみ出す側には倒れない。
 * ツールチップは `pointer-events: none` なので、押し戻しでバーに重なっても
 * 操作の邪魔にはならない。
 */
const ESTIMATED_HEIGHT = 220

/** バーにホバーしたときに表示する課題の詳細。 */
export function IssueTooltip({ state }: { state: TooltipState }) {
  const { issue, overdue } = state
  const viewportWidth = typeof window === 'undefined' ? WIDTH + MARGIN * 2 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? ESTIMATED_HEIGHT + MARGIN * 2 : window.innerHeight
  const left = Math.min(state.x + MARGIN, Math.max(MARGIN, viewportWidth - WIDTH - MARGIN))
  // 縦も横と同じように押し戻す。画面（.app）は height: 100vh でページ自体が
  // スクロールしないため、下端より下に出したツールチップは読む手段が無い。
  const top = Math.min(state.y + MARGIN, Math.max(MARGIN, viewportHeight - ESTIMATED_HEIGHT - MARGIN))

  const period =
    issue.startDate && issue.dueDate
      ? `${formatShort(issue.startDate)} 〜 ${formatShort(issue.dueDate)}`
      : issue.dueDate
        ? `期限 ${formatShort(issue.dueDate)}`
        : issue.startDate
          ? `${formatShort(issue.startDate)} 〜 (期限未設定)`
          : '日付未設定'

  return (
    <div className={styles.tooltip} style={{ left, top, width: WIDTH }} role="tooltip">
      <div className={styles.key}>{issue.issueKey}</div>
      <div className={styles.summary}>{issue.summary}</div>
      <dl className={styles.meta}>
        <dt>期間</dt>
        <dd className={styles.period} data-overdue={overdue}>
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
        {issue.categoryNames.length > 0 ? (
          <>
            <dt>カテゴリ</dt>
            <dd>{issue.categoryNames.join(', ')}</dd>
          </>
        ) : null}
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
