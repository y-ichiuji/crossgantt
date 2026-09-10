import { useMemo, useRef, useState } from 'react'

import { formatShort } from '../../shared/date'
import {
  barGeometry,
  buildScale,
  filterByRange,
  groupIssues,
  hasNoDate,
  isOverdue,
  minorTicks,
  monthTicks,
  projectColor,
  resolveBar,
  weekendBands,
  xOf
} from '../../shared/gantt'
import type { GanttIssue, ViewFilter } from '../../shared/types'
import { IssueTooltip, type TooltipState } from './IssueTooltip'

import styles from './GanttChart.module.css'

type Props = {
  issues: GanttIssue[]
  filter: ViewFilter
  today: string
  projectNames: Record<number, string>
}

/** 行の高さ（px）。CSS 側の値と合わせること。 */
const ROW_HEIGHT = 28

export function GanttChart({ issues, filter, today, projectNames }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

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
  const todayLeft = today >= filter.from && today <= filter.to ? xOf(today, scale) : null

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
        ref={scrollRef}
        style={{ '--timeline-width': `${scale.width}px` } as React.CSSProperties}
      >
        <div className={styles.inner}>
          <div className={styles.background} aria-hidden="true">
            {weekends.map((band) => (
              <div
                key={band.key}
                className={styles.weekend}
                data-testid="weekend-band"
                style={{ left: band.left, width: band.width }}
              />
            ))}
            {majors.map((tick) => (
              <div key={tick.key} className={styles.monthLine} style={{ left: tick.left }} />
            ))}
          </div>

          {/* 今日線はバーより手前に描くため、背景とは別のレイヤーに置く。 */}
          {todayLeft !== null ? (
            <div className={styles.foreground} aria-hidden="true">
              <div className={styles.today} data-testid="today-line" style={{ left: todayLeft }} />
            </div>
          ) : null}

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
                  <div key={tick.key} className={styles.tick} style={{ left: tick.left, width: tick.width }}>
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
                      const color = projectColor(issue.projectId)

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
                            <span
                              className={styles.projectChip}
                              style={{ backgroundColor: color }}
                              aria-hidden="true"
                            />
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
                              style={{ left: geometry.left, width: geometry.width, backgroundColor: color }}
                              href={issue.url}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`${label}（${period}、${issue.statusName}）`}
                              onMouseEnter={(event) => showTooltip(issue, event)}
                              onMouseMove={(event) => showTooltip(issue, event)}
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
              <span className={styles.projectChip} style={{ backgroundColor: projectColor(issue.projectId) }} />
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
