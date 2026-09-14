// 型としてだけ参照する（段数の照合に使う）ので、実行時の import は増やさない。
import type { MAX_GROUP_DEPTH } from '../../shared/filter'
import { projectColor } from '../../shared/gantt'
import type { GroupBy, MemberSummary, ProjectSummary, StatusGroup, ViewFilter, Zoom } from '../../shared/types'
import { MultiSelect } from './MultiSelect'

import styles from './FilterBar.module.css'

type Props = {
  filter: ViewFilter
  onChange: (patch: Partial<ViewFilter>) => void
  projects: ProjectSummary[]
  members: MemberSummary[]
  statuses: StatusGroup[]
  loading: boolean
}

const GROUP_LABELS: Record<GroupBy, string> = {
  assignee: '担当者別',
  project: 'プロジェクト別',
  milestone: 'マイルストーン別',
  category: 'カテゴリ別'
}

/**
 * グルーピングの段ごとの見出し。
 *
 * 段数の上限は `shared/filter.ts` が決めるため、要素数をその値に固定する。
 * 片方だけ変えると、select の数と実際に指定できる段数が静かに食い違う。
 * `satisfies` で長さを照合しておけば、ずれたまま通ることはない。
 */
const GROUP_SLOT_LABELS = ['大項目', '中項目', '小項目'] as const satisfies {
  length: typeof MAX_GROUP_DEPTH
}

/** 「なし」を表す select の値。`GroupBy` には無い値を使う。 */
const NO_AXIS = ''

const ZOOM_LABELS: Record<Zoom, string> = {
  day: '日',
  week: '週',
  month: '月'
}

/**
 * 指定した段の軸を差し替えた並びを返す。
 *
 * 「なし」を選んだら、その段から下をまとめて落とす。階層なので、中項目を
 * 空けたまま小項目だけ残すという状態は作らない。
 *
 * 下の段で使っていた軸を選んだ場合は、その軸を下から取り除く。同じ軸が
 * 2 段に並ぶと、下の段は必ず 1 グループだけになり見出しが増えるだけになる。
 */
function replaceAxis(axes: GroupBy[], depth: number, axis: GroupBy | typeof NO_AXIS): GroupBy[] {
  if (axis === NO_AXIS) {
    return axes.slice(0, depth)
  }
  return [...axes.slice(0, depth), axis, ...axes.slice(depth + 1).filter((value) => value !== axis)]
}

/** 表示条件を操作するツールバー。 */
export function FilterBar({ filter, onChange, projects, members, statuses, loading }: Props) {
  return (
    <div className={styles.bar}>
      <MultiSelect
        label="プロジェクト"
        emptyLabel="未選択"
        searchable
        options={projects.map((project) => ({
          value: String(project.id),
          label: `${project.projectKey} ${project.name}`,
          color: projectColor(project.id)
        }))}
        selected={filter.projectIds.map(String)}
        onChange={(values) => onChange({ projectIds: values.map(Number) })}
      />

      <MultiSelect
        label="担当者"
        emptyLabel="すべて"
        searchable
        options={members.map((member) => ({ value: String(member.id), label: member.name }))}
        selected={filter.assigneeIds.map(String)}
        onChange={(values) => onChange({ assigneeIds: values.map(Number) })}
        disabled={loading}
      />

      <MultiSelect
        label="ステータス"
        emptyLabel="完了以外すべて"
        options={statuses.map((status) => ({
          value: status.name,
          label: status.name,
          color: status.color ?? undefined
        }))}
        selected={filter.statusNames}
        onChange={(values) => onChange({ statusNames: values })}
        disabled={loading}
      />

      <label className={styles.field}>
        <span className={styles.label}>開始</span>
        <input
          type="date"
          className={styles.input}
          value={filter.from}
          onChange={(event) => onChange({ from: event.target.value })}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>終了</span>
        <input
          type="date"
          className={styles.input}
          value={filter.to}
          onChange={(event) => onChange({ to: event.target.value })}
        />
      </label>

      <fieldset className={styles.groupField}>
        <legend className={styles.groupLegend}>グルーピング</legend>
        <div className={styles.groupSlots}>
          {GROUP_SLOT_LABELS.map((slotLabel, depth) => {
            // 上の段で使った軸は選べないようにする。1 つ上が「なし」の段も
            // 選べない（中項目を空けたまま小項目だけ置くことはできない）。
            const used = new Set(filter.groupBy.slice(0, depth))
            return (
              <label key={slotLabel} className={styles.groupSlot}>
                <span className={styles.label}>{slotLabel}</span>
                <select
                  className={styles.groupSelect}
                  value={filter.groupBy[depth] ?? NO_AXIS}
                  disabled={depth > filter.groupBy.length}
                  onChange={(event) =>
                    onChange({
                      groupBy: replaceAxis(filter.groupBy, depth, event.target.value as GroupBy | typeof NO_AXIS)
                    })
                  }
                >
                  {/* 大項目は必ず 1 つ要る。ここを空にすると 1 行も描けない。 */}
                  {depth > 0 ? <option value={NO_AXIS}>なし</option> : null}
                  {(Object.keys(GROUP_LABELS) as GroupBy[])
                    .filter((value) => !used.has(value))
                    .map((value) => (
                      <option key={value} value={value}>
                        {GROUP_LABELS[value]}
                      </option>
                    ))}
                </select>
              </label>
            )
          })}
        </div>
      </fieldset>

      <fieldset className={styles.zoomField}>
        <legend className={styles.zoomLabel}>ズーム</legend>
        <div className={styles.zoomGroup}>
          {(Object.keys(ZOOM_LABELS) as Zoom[]).map((value) => (
            <button
              key={value}
              type="button"
              className={styles.zoomButton}
              onClick={() => onChange({ zoom: value })}
              aria-pressed={value === filter.zoom}
            >
              {ZOOM_LABELS[value]}
            </button>
          ))}
        </div>
      </fieldset>

      <label className={styles.fieldGrow}>
        <span className={styles.label}>キーワード</span>
        <input
          type="search"
          className={styles.input}
          value={filter.keyword}
          onChange={(event) => onChange({ keyword: event.target.value })}
          placeholder="件名で検索"
        />
      </label>

      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={filter.includeClosed}
          onChange={(event) => onChange({ includeClosed: event.target.checked })}
        />
        <span>完了を含む</span>
      </label>

      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={filter.includeNoDate}
          onChange={(event) => onChange({ includeNoDate: event.target.checked })}
        />
        <span>日付未設定を含む</span>
      </label>
    </div>
  )
}
