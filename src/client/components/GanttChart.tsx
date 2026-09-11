import { useMemo, useState } from 'react'

import { formatShort } from '../../shared/date'
import {
  barGeometry,
  buildScale,
  filterByRange,
  groupIssues,
  holidayBands,
  hasNoDate,
  isOverdue,
  minorTicks,
  monthTicks,
  readableTextColor,
  resolveBar,
  statusColor,
  todayBand,
  weekendBands
} from '../../shared/gantt'
import type { GanttIssue, Holiday, ViewFilter } from '../../shared/types'
import { AssigneeAvatar } from './AssigneeAvatar'
import { IssueTooltip } from './IssueTooltip'
import type { TooltipState } from './IssueTooltip'

import styles from './GanttChart.module.css'

type Props = {
  issues: GanttIssue[]
  filter: ViewFilter
  today: string
  projectNames: Record<number, string>
  /** 表示期間内の日本の祝日。取得前や取得に失敗したときは空配列。 */
  holidays: readonly Holiday[]
  /**
   * 課題を取得中かどうか。
   *
   * 取得中は呼び出し側が覆いをかける。その裏でスクロールバーだけが
   * 残っていると操作できそうに見えるため、スクロールを止めて隠す。
   */
  loading: boolean
}

/** 行の高さ（px）。CSS 側の値と合わせること。 */
const ROW_HEIGHT = 28

export function GanttChart({ issues, filter, today, projectNames, holidays, loading }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const scale = useMemo(() => buildScale(filter.from, filter.to, filter.zoom), [filter.from, filter.to, filter.zoom])

  const dated = useMemo(
    () => filterByRange(issues, filter.from, filter.to, today),
    [issues, filter.from, filter.to, today]
  )
  const groups = useMemo(
    () => groupIssues(dated, filter.groupBy, today, projectNames),
    [dated, filter.groupBy, today, projectNames]
  )
  const undated = useMemo(() => issues.filter(hasNoDate), [issues])

  const majors = useMemo(() => monthTicks(scale), [scale])
  const minors = useMemo(() => minorTicks(scale, filter.zoom), [scale, filter.zoom])
  const weekends = useMemo(() => weekendBands(scale, filter.zoom), [scale, filter.zoom])
  const holidayBandList = useMemo(() => holidayBands(scale, filter.zoom, holidays), [scale, filter.zoom, holidays])
  const holidayByKey = useMemo(() => new Map(holidayBandList.map((band) => [band.key, band.label])), [holidayBandList])
  const todayColumn = useMemo(() => todayBand(scale, filter.zoom, today), [scale, filter.zoom, today])

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const showTooltip = (issue: GanttIssue, event: { clientX: number; clientY: number }) => {
    setTooltip({ issue, x: event.clientX, y: event.clientY, overdue: isOverdue(issue, today) })
  }

  if (dated.length === 0 && undated.length === 0) {
    return (
      <div className={styles.empty}>
        <p>表示できる課題がありません。</p>
        <p className={styles.emptyHint}>
          プロジェクトの選択、表示期間、ステータスの条件を見直してください。日付が設定されていない課題は
          「日付未設定を含む」を有効にすると一覧に表示されます。
        </p>
      </div>
    )
  }

  return (
    <>
      <div
        className={styles.scroller}
        data-testid="gantt-scroller"
        data-loading={loading}
        style={
          {
            '--timeline-width': `${scale.width}px`,
            // 日ズームでは 1 日ごと、それ以外は 1 週ごとに薄い罫線を引く。
            '--grid-step': `${filter.zoom === 'day' ? scale.pxPerDay : scale.pxPerDay * 7}px`
          } as React.CSSProperties
        }
      >
        <div className={styles.inner}>
          {/*
           * 今日の帯・土日・月境界はいずれも背景として扱う。固定表示の課題名カラム
           * （.rowHead）より奥のレイヤーに置くことで、横スクロールして今日の位置が
           * カラムに重なっても課題キーと件名を隠さない。
           */}
          <div className={styles.background} aria-hidden="true">
            {weekends.map((band) => (
              <div
                key={band.key}
                className={styles.weekend}
                data-testid="weekend-band"
                style={{ left: band.left, width: band.width }}
              />
            ))}
            {/* 祝日は土日より濃く塗るので、土日の帯より後に重ねる。 */}
            {holidayBandList.map((band) => (
              <div
                key={band.key}
                className={styles.holiday}
                data-testid="holiday-band"
                style={{ left: band.left, width: band.width }}
              />
            ))}
            {/* 今日が土日・祝日に当たることもあるため、いちばん後に重ねる。 */}
            {todayColumn ? (
              <div
                className={styles.today}
                data-testid="today-column"
                style={{ left: todayColumn.left, width: todayColumn.width }}
              />
            ) : null}
            {majors.map((tick) => (
              <div key={tick.key} className={styles.monthLine} style={{ left: tick.left }} />
            ))}
          </div>

          <div className={styles.header}>
            <div className={styles.headCell}>課題</div>
            <div className={styles.headTrack}>
              <div className={styles.ticksMajor}>
                {majors.map((tick) => (
                  <div key={tick.key} className={styles.tick} style={{ left: tick.left, width: tick.width }}>
                    {tick.label}
                  </div>
                ))}
              </div>
              <div className={styles.ticksMinor}>
                {minors.map((tick) => (
                  <div
                    key={tick.key}
                    className={styles.tick}
                    // 帯はヘッダーの下に隠れるため、目盛り側でも今日の列を示す。
                    data-today={tick.key === todayColumn?.key}
                    // 帯は装飾（aria-hidden）なので、祝日の名称はここで伝える。
                    data-holiday={holidayByKey.has(tick.key)}
                    title={holidayByKey.get(tick.key)}
                    style={{ left: tick.left, width: tick.width }}
                  >
                    {tick.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.key)
            return (
              <div key={group.key}>
                <div className={styles.groupRow}>
                  <div className={styles.rowHead}>
                    <button type="button" className={styles.groupToggle} onClick={() => toggleGroup(group.key)}>
                      <span aria-hidden="true">{isCollapsed ? '▶' : '▼'}</span>
                      {filter.groupBy === 'assignee' ? (
                        <AssigneeAvatar assigneeId={group.assigneeId} assigneeName={group.label} size="md" />
                      ) : null}
                      <span className={styles.groupName}>{group.label}</span>
                      <span className={styles.groupCount}>{group.issues.length}件</span>
                      {group.overdueCount > 0 ? (
                        <span className={styles.overdueBadge}>{group.overdueCount}件遅延</span>
                      ) : null}
                    </button>
                  </div>
                  <div className={styles.rowTrack} />
                </div>

                {isCollapsed
                  ? null
                  : group.issues.map((issue) => {
                      const bar = resolveBar(issue, today)
                      if (!bar) {
                        return null
                      }
                      const geometry = barGeometry(bar, scale)
                      const overdue = isOverdue(issue, today)
                      // Backlog のガントチャートと同じく、バーの色はステータスで決める。
                      const background = statusColor(issue)
                      const foreground = readableTextColor(background)

                      const label = `${issue.issueKey} ${issue.summary}`
                      const period =
                        bar.start === bar.end
                          ? formatShort(bar.start)
                          : `${formatShort(bar.start)}〜${formatShort(bar.end)}`

                      return (
                        <div
                          className={styles.row}
                          key={issue.id}
                          style={{ contentVisibility: 'auto', containIntrinsicSize: `${ROW_HEIGHT}px` }}
                        >
                          <div className={styles.rowHead}>
                            <AssigneeAvatar assigneeId={issue.assigneeId} assigneeName={issue.assigneeName} />
                            <a
                              className={styles.issueLink}
                              href={issue.url}
                              target="_blank"
                              rel="noreferrer"
                              title={label}
                            >
                              <span className={styles.issueKey}>{issue.issueKey}</span>
                              <span className={styles.issueSummary}>{issue.summary}</span>
                            </a>
                          </div>
                          <div className={styles.rowTrack}>
                            <a
                              className={styles.bar}
                              data-testid="gantt-bar"
                              data-kind={bar.kind}
                              data-overdue={overdue}
                              data-closed={issue.isClosed}
                              data-clip-start={geometry.clippedStart}
                              data-clip-end={geometry.clippedEnd}
                              style={{
                                left: geometry.left,
                                width: geometry.width,
                                backgroundColor: background,
                                color: foreground
                              }}
                              href={issue.url}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`${label}（${period}、${issue.statusName}）`}
                              onMouseEnter={(event) => showTooltip(issue, event)}
                              // mousemove ごとに setTooltip すると、毎秒数十回チャート全体が
                              // 再レンダリングされる（行数ぶんの再計算と差分検出が走る）。
                              // 位置決めは onMouseEnter の 1 回で足りる。
                              onMouseLeave={() => setTooltip(null)}
                              onFocus={(event) => {
                                const rect = event.currentTarget.getBoundingClientRect()
                                showTooltip(issue, { clientX: rect.left, clientY: rect.bottom })
                              }}
                              onBlur={() => setTooltip(null)}
                            >
                              {geometry.width >= 64 ? <span className={styles.barLabel}>{issue.summary}</span> : null}
                            </a>
                          </div>
                        </div>
                      )
                    })}
              </div>
            )
          })}
        </div>
      </div>

      {filter.includeNoDate && undated.length > 0 ? (
        <NoDateSection issues={undated} projectNames={projectNames} />
      ) : null}

      {tooltip ? <IssueTooltip state={tooltip} /> : null}
    </>
  )
}

function NoDateSection({ issues, projectNames }: { issues: GanttIssue[]; projectNames: Record<number, string> }) {
  const [open, setOpen] = useState(false)
  return (
    <section className={styles.noDate}>
      <button type="button" className={styles.noDateToggle} onClick={() => setOpen((value) => !value)}>
        <span aria-hidden="true">{open ? '▼' : '▶'}</span>
        日付未設定の課題 {issues.length}件
      </button>
      {open ? (
        <ul className={styles.noDateList}>
          {issues.map((issue) => (
            <li key={issue.id}>
              <AssigneeAvatar assigneeId={issue.assigneeId} assigneeName={issue.assigneeName} />
              <a href={issue.url} target="_blank" rel="noreferrer">
                <span className={styles.issueKey}>{issue.issueKey}</span> {issue.summary}
              </a>
              <span className={styles.noDateMeta}>
                {projectNames[issue.projectId] ?? issue.projectKey} / {issue.assigneeName ?? '未割り当て'} /{' '}
                {issue.statusName}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
