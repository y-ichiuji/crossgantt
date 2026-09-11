import type { GanttSummary } from '../../shared/gantt'

import styles from './SummaryBar.module.css'

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
    <div className={styles.bar}>
      <span className={styles.item}>
        期間内 <strong>{summary.inRange}</strong> 件
      </span>
      <span className={styles.item} data-overdue={summary.overdue > 0}>
        遅延 <strong>{summary.overdue}</strong> 件
      </span>
      <span className={styles.item}>
        日付未設定 <strong>{summary.noDate}</strong> 件
      </span>
      <span className={styles.muted}>取得 {summary.total} 件</span>

      {truncated ? (
        <output className={styles.warning}>
          件数が多いため一部のみ表示しています。期間やプロジェクトを絞り込んでください。
        </output>
      ) : null}

      <span className={styles.spacer} />

      {/*
       * 取得中であることはチャート上の覆いが示すため、ここには出さない。
       * 代わりに、古いままの取得時刻を見せないよう取り下げる。
       */}
      {!loading && fetchedAt ? (
        <span className={styles.muted}>
          {formatTime(fetchedAt)} 時点 / Backlog API {requestCount} リクエスト
        </span>
      ) : null}
    </div>
  )
}
