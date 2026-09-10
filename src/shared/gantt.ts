/**
 * ガントチャートの描画ロジック（純粋関数）。
 *
 * DOM に依存しないため、そのままユニットテストできる。
 */

import {
  addDays,
  addMonths,
  clampDate,
  diffDays,
  endOfMonth,
  formatMonthLabel,
  formatShort,
  isWeekend,
  overlaps,
  startOfMonth,
  startOfWeek,
  toTime
} from './date'
import type { GanttIssue, GroupBy, Zoom } from './types'

/**
 * バーの種類。
 * - `range`: 開始日と期限日の両方がある通常のバー
 * - `due-marker`: 期限日のみ。1 日分のマーカーとして描画する
 * - `open-ended`: 開始日のみ。開始日から今日までを終端不明のバーとして描画する
 */
export type BarKind = 'range' | 'due-marker' | 'open-ended'

export type IssueBar = {
  kind: BarKind
  start: string
  end: string
}

/**
 * 課題からバーの期間を決める。日付が一切設定されていない課題は null を返す。
 */
export function resolveBar(issue: GanttIssue, today: string): IssueBar | null {
  const { startDate, dueDate } = issue

  if (startDate && dueDate) {
    // 開始日が期限日より後という不整合データもありうるので順序を正す。
    const [start, end] = toTime(startDate) <= toTime(dueDate) ? [startDate, dueDate] : [dueDate, startDate]
    return { kind: 'range', start, end }
  }
  if (!startDate && dueDate) {
    return { kind: 'due-marker', start: dueDate, end: dueDate }
  }
  if (startDate && !dueDate) {
    const end = toTime(today) > toTime(startDate) ? today : startDate
    return { kind: 'open-ended', start: startDate, end }
  }
  return null
}

/** 期限超過かつ未完了なら true。 */
export function isOverdue(issue: GanttIssue, today: string): boolean {
  if (issue.isClosed || !issue.dueDate) {
    return false
  }
  return toTime(issue.dueDate) < toTime(today)
}

/** 日付が一切設定されていない課題なら true。 */
export function hasNoDate(issue: GanttIssue): boolean {
  return !issue.startDate && !issue.dueDate
}

/** 表示期間に重なる課題だけを残す。日付なし課題は常に除外する。 */
export function filterByRange(issues: GanttIssue[], from: string, to: string, today: string): GanttIssue[] {
  return issues.filter((issue) => {
    const bar = resolveBar(issue, today)
    if (!bar) {
      return false
    }
    return overlaps(bar.start, bar.end, from, to)
  })
}

// --- グルーピング ---

export type GanttGroup = {
  key: string
  label: string
  issues: GanttIssue[]
  overdueCount: number
  /** 担当者別のときだけ入る。見出しにアイコンを出すために使う。 */
  assigneeId: number | null
}

const UNASSIGNED_KEY = '__unassigned__'
const NO_MILESTONE_KEY = '__no_milestone__'

/** 課題の並び順。開始日 → 期限日 → 課題キーの順で安定ソートする。 */
function compareIssues(a: GanttIssue, b: GanttIssue): number {
  const aKey = a.startDate ?? a.dueDate ?? '9999-12-31'
  const bKey = b.startDate ?? b.dueDate ?? '9999-12-31'
  if (aKey !== bKey) {
    return aKey < bKey ? -1 : 1
  }
  const aDue = a.dueDate ?? '9999-12-31'
  const bDue = b.dueDate ?? '9999-12-31'
  if (aDue !== bDue) {
    return aDue < bDue ? -1 : 1
  }
  return a.issueKey.localeCompare(b.issueKey)
}

/** グループの並び順。「未割り当て」「マイルストーンなし」は末尾に置く。 */
function compareGroups(a: GanttGroup, b: GanttGroup): number {
  const aLast = a.key === UNASSIGNED_KEY || a.key === NO_MILESTONE_KEY
  const bLast = b.key === UNASSIGNED_KEY || b.key === NO_MILESTONE_KEY
  if (aLast !== bLast) {
    return aLast ? 1 : -1
  }
  return a.label.localeCompare(b.label, 'ja')
}

/**
 * 課題をグルーピング軸ごとにまとめる。
 *
 * マイルストーン軸では、複数のマイルストーンに属する課題は
 * それぞれのグループに重複して現れる（Backlog の仕様上ありうるため）。
 */
export function groupIssues(
  issues: GanttIssue[],
  groupBy: GroupBy,
  today: string,
  projectNames: Record<number, string> = {}
): GanttGroup[] {
  const buckets = new Map<string, GanttGroup>()

  const push = (key: string, label: string, issue: GanttIssue, assigneeId: number | null = null) => {
    let group = buckets.get(key)
    if (!group) {
      group = { key, label, issues: [], overdueCount: 0, assigneeId }
      buckets.set(key, group)
    }
    group.issues.push(issue)
    if (isOverdue(issue, today)) {
      group.overdueCount += 1
    }
  }

  for (const issue of issues) {
    if (groupBy === 'assignee') {
      const key = issue.assigneeId === null ? UNASSIGNED_KEY : `u${issue.assigneeId}`
      push(key, issue.assigneeName ?? '未割り当て', issue, issue.assigneeId)
    } else if (groupBy === 'project') {
      const label = projectNames[issue.projectId] ?? issue.projectKey
      push(`p${issue.projectId}`, label, issue)
    } else if (issue.milestoneNames.length === 0) {
      push(NO_MILESTONE_KEY, 'マイルストーンなし', issue)
    } else {
      for (const name of issue.milestoneNames) {
        push(`m:${name}`, name, issue)
      }
    }
  }

  const groups = [...buckets.values()]
  for (const group of groups) {
    group.issues = group.issues.toSorted(compareIssues)
  }
  return groups.toSorted(compareGroups)
}

// --- サマリー ---

export type GanttSummary = {
  total: number
  overdue: number
  noDate: number
  inRange: number
}

export function summarize(issues: GanttIssue[], from: string, to: string, today: string): GanttSummary {
  let overdue = 0
  let noDate = 0
  let inRange = 0
  for (const issue of issues) {
    if (isOverdue(issue, today)) {
      overdue += 1
    }
    if (hasNoDate(issue)) {
      noDate += 1
      continue
    }
    const bar = resolveBar(issue, today)
    if (bar && overlaps(bar.start, bar.end, from, to)) {
      inRange += 1
    }
  }
  return { total: issues.length, overdue, noDate, inRange }
}

// --- タイムラインの座標計算 ---

/** ズームごとの 1 日あたりのピクセル数。 */
export const PX_PER_DAY: Record<Zoom, number> = {
  day: 30,
  week: 12,
  month: 5
}

export type TimelineScale = {
  from: string
  to: string
  /** 表示日数（両端を含む）。 */
  days: number
  pxPerDay: number
  /** タイムライン全体の幅（px）。 */
  width: number
}

export function buildScale(from: string, to: string, zoom: Zoom): TimelineScale {
  const pxPerDay = PX_PER_DAY[zoom]
  const days = Math.max(1, diffDays(from, to) + 1)
  return { from, to, days, pxPerDay, width: days * pxPerDay }
}

/** DateKey をタイムライン左端からのピクセル位置に変換する。 */
export function xOf(dateKey: string, scale: TimelineScale): number {
  return diffDays(scale.from, dateKey) * scale.pxPerDay
}

export type BarGeometry = {
  left: number
  width: number
  /** 表示期間の左端で切り詰められた場合 true。 */
  clippedStart: boolean
  /** 表示期間の右端で切り詰められた場合 true。 */
  clippedEnd: boolean
}

/** バーの表示位置と幅を求める。表示期間外にはみ出す分は切り詰める。 */
export function barGeometry(bar: IssueBar, scale: TimelineScale): BarGeometry {
  const clippedStart = toTime(bar.start) < toTime(scale.from)
  const clippedEnd = toTime(bar.end) > toTime(scale.to)
  const start = clampDate(bar.start, scale.from, scale.to)
  const end = clampDate(bar.end, scale.from, scale.to)
  const left = xOf(start, scale)
  // 終端の当日分を含めるため +1 日。
  const width = Math.max(scale.pxPerDay, (diffDays(start, end) + 1) * scale.pxPerDay)
  return { left, width, clippedStart, clippedEnd }
}

// --- 目盛り ---

export type TimelineTick = {
  key: string
  label: string
  left: number
  width: number
}

/** 月単位の目盛り（ヘッダー上段）。 */
export function monthTicks(scale: TimelineScale): TimelineTick[] {
  const ticks: TimelineTick[] = []
  let cursor = startOfMonth(scale.from)
  // 表示開始月が期間より前から始まるため、最初のセルだけ左端に合わせる。
  while (toTime(cursor) <= toTime(scale.to)) {
    const monthStart = cursor
    const monthEnd = endOfMonth(cursor)
    const visibleStart = clampDate(monthStart, scale.from, scale.to)
    const visibleEnd = clampDate(monthEnd, scale.from, scale.to)
    ticks.push({
      key: monthStart,
      label: formatMonthLabel(monthStart),
      left: xOf(visibleStart, scale),
      width: (diffDays(visibleStart, visibleEnd) + 1) * scale.pxPerDay
    })
    cursor = addMonths(monthStart, 1)
  }
  return ticks
}

/** 日または週単位の目盛り（ヘッダー下段）。 */
export function minorTicks(scale: TimelineScale, zoom: Zoom): TimelineTick[] {
  const ticks: TimelineTick[] = []
  if (zoom === 'day') {
    for (let i = 0; i < scale.days; i += 1) {
      const dateKey = addDays(scale.from, i)
      ticks.push({
        key: dateKey,
        label: String(Number(dateKey.slice(8, 10))),
        left: i * scale.pxPerDay,
        width: scale.pxPerDay
      })
    }
    return ticks
  }

  let cursor = startOfWeek(scale.from)
  while (toTime(cursor) <= toTime(scale.to)) {
    const weekEnd = addDays(cursor, 6)
    const visibleStart = clampDate(cursor, scale.from, scale.to)
    const visibleEnd = clampDate(weekEnd, scale.from, scale.to)
    ticks.push({
      key: cursor,
      label: formatShort(visibleStart),
      left: xOf(visibleStart, scale),
      width: (diffDays(visibleStart, visibleEnd) + 1) * scale.pxPerDay
    })
    cursor = addDays(cursor, 7)
  }
  return ticks
}

/** 土日の帯（日ズームのときのみ意味を持つ）。 */
export function weekendBands(scale: TimelineScale, zoom: Zoom): TimelineTick[] {
  if (zoom !== 'day') {
    return []
  }
  const bands: TimelineTick[] = []
  for (let i = 0; i < scale.days; i += 1) {
    const dateKey = addDays(scale.from, i)
    if (isWeekend(dateKey)) {
      bands.push({ key: dateKey, label: '', left: i * scale.pxPerDay, width: scale.pxPerDay })
    }
  }
  return bands
}

// --- 色 ---

/** プロジェクトごとのバー色パレット。彩度を抑えて多数並べても見やすくしている。 */
export const PROJECT_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#6366f1',
  '#84cc16',
  '#06b6d4'
] as const

/**
 * プロジェクト ID から安定的に色を決める。
 *
 * ID をそのまま剰余に掛けると、100 と 200 のような切りのよい ID が
 * 同じ色に落ちやすいため、Knuth の乗算ハッシュで 32 ビットに混ぜる。
 * ただし乗算ハッシュで質が良いのは上位ビットで、下位ビットには規則性が残る。
 * 乗数は奇数なので `hashed % 2` は `projectId % 2` と一致してしまい、
 * 剰余を取ると偶数 ID が偶数番目の色にしか当たらない。
 * 上位ビットを使うため、剰余ではなく 0〜1 に正規化してから割り当てる。
 */
export function projectColor(projectId: number): string {
  const hashed = Math.imul(projectId | 0, 2654435761) >>> 0
  return PROJECT_COLORS[Math.floor((hashed / 0x1_0000_0000) * PROJECT_COLORS.length)]
}

/** Backlog がステータスに色を持たない場合のフォールバック。 */
export const FALLBACK_STATUS_COLOR = '#94a3b8'

/** バーの背景色。Backlog のガントチャートと同じくステータスの色を使う。 */
export function statusColor(issue: GanttIssue): string {
  return issue.statusColor ?? FALLBACK_STATUS_COLOR
}

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** `#rgb` / `#rrggbb` を 0〜255 の RGB に分解する。解釈できなければ null。 */
function parseHexColor(color: string): [number, number, number] | null {
  if (!HEX_COLOR.test(color)) {
    return null
  }
  const hex = color.slice(1)
  // `#abc` を `#aabbcc` に展開する。16 進数字だけなので 1 文字ずつで問題ない。
  const full = hex.length === 3 ? hex.replace(/./g, (char) => char + char) : hex
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16)
  ]
}

/** sRGB の 1 チャンネルを相対輝度の計算用に線形化する。 */
function toLinear(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** WCAG の相対輝度。0（黒）〜 1（白）。 */
export function relativeLuminance(color: string): number {
  const rgb = parseHexColor(color)
  if (!rgb) {
    // 解釈できない色は暗いものとみなし、白文字を選ばせる。
    return 0
  }
  const [red, green, blue] = rgb
  return 0.2126 * toLinear(red) + 0.7152 * toLinear(green) + 0.0722 * toLinear(blue)
}

/** バーの文字色の候補。 */
const DARK_TEXT = '#1c2430'
const LIGHT_TEXT = '#ffffff'

/** WCAG のコントラスト比。1（同色）〜 21（黒と白）。 */
function contrastRatio(a: number, b: number): number {
  const [brighter, darker] = a >= b ? [a, b] : [b, a]
  return (brighter + 0.05) / (darker + 0.05)
}

/**
 * 指定した背景色の上で読みやすい文字色を返す。
 *
 * Backlog のステータス色は明るいもの（例: 完了の #b0be3c）と
 * 暗いものが混在するため、固定の白文字だと読めなくなる。
 *
 * 輝度をしきい値と比べる方法では、そのしきい値が白黒の分かれ目
 * （この配色では約 0.216）と一致していないと中間色で誤った側を選ぶ。
 * 実際にコントラスト比を計算して高い方を採るのが確実で、
 * しきい値という調整の要る定数も持たずに済む。
 */
export function readableTextColor(background: string): string {
  const luminance = relativeLuminance(background)
  const onDark = contrastRatio(luminance, relativeLuminance(DARK_TEXT))
  const onLight = contrastRatio(luminance, relativeLuminance(LIGHT_TEXT))
  return onDark >= onLight ? DARK_TEXT : LIGHT_TEXT
}
