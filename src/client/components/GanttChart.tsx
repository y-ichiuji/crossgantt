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
      <div className="gantt-empty">
        <p>表示できる課題がありません。</p>
        <p className="gantt-empty__hint">
          プロジェクトの選択、表示期間、ステータスの条件を見直してください。日付が設定されていない課題は
          「日付未設定を含む」を有効にすると一覧に表示されます。
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="gantt" ref={scrollRef} style={{ '--timeline-width': `${scale.width}px` } as React.CSSProperties}>
        <div className="gantt__inner">
          <div className="gantt__bg" aria-hidden="true">
            {weekends.map((band) => (
              <div key={band.key} className="gantt__weekend" style={{ left: band.left, width: band.width }} />
            ))}
            {majors.map((tick) => (
              <div key={tick.key} className="gantt__month-line" style={{ left: tick.left }} />
            ))}
          </div>

          {/* 今日線はバーより手前に描くため、背景とは別のレイヤーに置く。 */}
          {todayLeft !== null ? (
            <div className="gantt__fg" aria-hidden="true">
              <div className="gantt__today" style={{ left: todayLeft }} />
            </div>
          ) : null}

          <div className="gantt__header">
            <div className="gantt__head-cell">課題</div>
            <div className="gantt__head-track">
              <div className="gantt__ticks gantt__ticks--major">
                {majors.map((tick) => (
                  <div key={tick.key} className="gantt__tick" style={{ left: tick.left, width: tick.width }}>
                    {tick.label}
                  </div>
                ))}
              </div>
              <div className="gantt__ticks gantt__ticks--minor">
                {minors.map((tick) => (
                  <div key={tick.key} className="gantt__tick" style={{ left: tick.left, width: tick.width }}>
                    {tick.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.key)
            return (
              <div className="gantt__group" key={group.key}>
                <div className="gantt__row gantt__row--group">
                  <div className="gantt__row-head">
                    <button type="button" className="gantt__group-toggle" onClick={() => toggleGroup(group.key)}>
                      <span aria-hidden="true">{isCollapsed ? '▶' : '▼'}</span>
                      <span className="gantt__group-name">{group.label}</span>
                      <span className="gantt__group-count">{group.issues.length}件</span>
                      {group.overdueCount > 0 ? (
                        <span className="badge badge--overdue">{group.overdueCount}件遅延</span>
                      ) : null}
                    </button>
                  </div>
                  <div className="gantt__row-track" />
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
                      const classNames = [
                        'gantt__bar',
                        `gantt__bar--${bar.kind}`,
                        overdue ? 'gantt__bar--overdue' : '',
                        issue.isClosed ? 'gantt__bar--closed' : '',
                        geometry.clippedStart ? 'gantt__bar--clip-start' : '',
                        geometry.clippedEnd ? 'gantt__bar--clip-end' : ''
                      ]
                        .filter(Boolean)
                        .join(' ')

                      const label = `${issue.issueKey} ${issue.summary}`
                      const period = `${bar.start === bar.end ? formatShort(bar.start) : `${formatShort(bar.start)}〜${formatShort(bar.end)}`}`

                      return (
                        <div
                          className="gantt__row"
                          key={issue.id}
                          style={{ contentVisibility: 'auto', containIntrinsicSize: `${ROW_HEIGHT}px` }}
                        >
                          <div className="gantt__row-head">
                            <span
                              className="gantt__project-chip"
                              style={{ backgroundColor: color }}
                              aria-hidden="true"
                            />
                            <a
                              className="gantt__issue-link"
                              href={issue.url}
                              target="_blank"
                              rel="noreferrer"
                              title={label}
                            >
                              <span className="gantt__issue-key">{issue.issueKey}</span>
                              <span className="gantt__issue-summary">{issue.summary}</span>
                            </a>
                          </div>
                          <div className="gantt__row-track">
                            <a
                              className={classNames}
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
                              {geometry.width >= 64 ? <span className="gantt__bar-label">{issue.summary}</span> : null}
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
    <section className="nodate">
      <button type="button" className="nodate__toggle" onClick={() => setOpen((value) => !value)}>
        <span aria-hidden="true">{open ? '▼' : '▶'}</span>
        日付未設定の課題 {issues.length}件
      </button>
      {open ? (
        <ul className="nodate__list">
          {issues.map((issue) => (
            <li key={issue.id}>
              <span className="gantt__project-chip" style={{ backgroundColor: projectColor(issue.projectId) }} />
              <a href={issue.url} target="_blank" rel="noreferrer">
                <span className="gantt__issue-key">{issue.issueKey}</span> {issue.summary}
              </a>
              <span className="nodate__meta">
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
