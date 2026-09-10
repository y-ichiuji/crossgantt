import { projectColor } from '../../shared/gantt'
import type { GroupBy, MemberSummary, ProjectSummary, StatusGroup, ViewFilter, Zoom } from '../../shared/types'
import { MultiSelect } from './MultiSelect'

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
  milestone: 'マイルストーン別'
}

const ZOOM_LABELS: Record<Zoom, string> = {
  day: '日',
  week: '週',
  month: '月'
}

/** 表示条件を操作するツールバー。 */
export function FilterBar({ filter, onChange, projects, members, statuses, loading }: Props) {
  return (
    <div className="filter-bar">
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

      <label className="field">
        <span className="field-label">開始</span>
        <input type="date" value={filter.from} onChange={(event) => onChange({ from: event.target.value })} />
      </label>

      <label className="field">
        <span className="field-label">終了</span>
        <input type="date" value={filter.to} onChange={(event) => onChange({ to: event.target.value })} />
      </label>

      <label className="field">
        <span className="field-label">グルーピング</span>
        <select value={filter.groupBy} onChange={(event) => onChange({ groupBy: event.target.value as GroupBy })}>
          {(Object.keys(GROUP_LABELS) as GroupBy[]).map((value) => (
            <option key={value} value={value}>
              {GROUP_LABELS[value]}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="field zoom-field">
        <legend className="field-label">ズーム</legend>
        <div className="zoom-group">
          {(Object.keys(ZOOM_LABELS) as Zoom[]).map((value) => (
            <button
              key={value}
              type="button"
              className={value === filter.zoom ? 'zoom-group__button is-active' : 'zoom-group__button'}
              onClick={() => onChange({ zoom: value })}
              aria-pressed={value === filter.zoom}
            >
              {ZOOM_LABELS[value]}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="field field--grow">
        <span className="field-label">キーワード</span>
        <input
          type="search"
          value={filter.keyword}
          onChange={(event) => onChange({ keyword: event.target.value })}
          placeholder="件名で検索"
        />
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={filter.includeClosed}
          onChange={(event) => onChange({ includeClosed: event.target.checked })}
        />
        <span>完了を含む</span>
      </label>

      <label className="checkbox">
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
