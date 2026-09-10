import type { GanttSummary } from '../../shared/gantt'

type Props = {
  summary: GanttSummary
  truncated: boolean
  requestCount: number
  fetchedAt: string | null
  loading: boolean
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 件数と取得状況のサマリー。 */
export function SummaryBar({ summary, truncated, requestCount, fetchedAt, loading }: Props) {
  return (
    <div className="summary">
      <span className="summary__item">
        期間内 <strong>{summary.inRange}</strong> 件
      </span>
      <span className={summary.overdue > 0 ? 'summary__item is-overdue' : 'summary__item'}>
        遅延 <strong>{summary.overdue}</strong> 件
      </span>
      <span className="summary__item">
        日付未設定 <strong>{summary.noDate}</strong> 件
      </span>
      <span className="summary__item summary__item--muted">取得 {summary.total} 件</span>

      {truncated ? (
        <span className="summary__warning" role="status">
          件数が多いため一部のみ表示しています。期間やプロジェクトを絞り込んでください。
        </span>
      ) : null}

      <span className="summary__spacer" />

      {loading ? <span className="summary__item summary__item--muted">読み込み中…</span> : null}
      {!loading && fetchedAt ? (
        <span className="summary__item summary__item--muted">
          {formatTime(fetchedAt)} 時点 / Backlog API {requestCount} リクエスト
        </span>
      ) : null}
    </div>
  )
}
