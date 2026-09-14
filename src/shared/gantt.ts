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
import type { GanttIssue, GroupBy, Holiday, Zoom } from './types'

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

/**
 * グルーピングされた課題のひとかたまり。
 *
 * 大項目・中項目・小項目は同じ形で表し、下位の階層を `children` に持つ。
 * 課題が入るのは最下段だけで、上位の階層は件数だけを持つ。
 */
export type GanttGroup = {
  /**
   * 祖先のキーを連ねた識別子。
   *
   * 同じ名前のカテゴリが別々のプロジェクトにぶら下がることがあるため、
   * その階層だけでは一意にならない。折りたたみ状態はこのキーで覚える。
   */
  key: string
  label: string
  /** この階層の軸。見出しの見せ方を変えるために使う。 */
  groupBy: GroupBy
  /** 0 が大項目。 */
  depth: number
  /** 下位の階層。最下段では空。 */
  children: GanttGroup[]
  /** 最下段のときだけ入る。 */
  issues: GanttIssue[]
  /**
   * 配下の課題数。
   *
   * カテゴリとマイルストーンは 1 課題に複数付けられるため、下位の階層に
   * 同じ課題が何度も現れる。ここは実際の課題数を出したいので、重複は除く
   * （つまり子の件数の合計とは一致しないことがある）。
   */
  issueCount: number
  /** 配下の期限超過かつ未完了の課題数。`issueCount` と同じく重複を除く。 */
  overdueCount: number
  /** 担当者別のときだけ入る。見出しにアイコンを出すために使う。 */
  assigneeId: number | null
}

/**
 * 値が設定されていない課題を集める先のキー。
 *
 * 同じ階層の他のキーは `u`・`p`・`n:` で始まるため衝突しない。
 */
const UNSET_KEY = '__unset__'

/**
 * 値が設定されていない課題を集めるグループの名前。
 *
 * プロジェクトは必ず 1 つ決まるため、この表には無い。
 */
const UNSET_LABELS: Record<'assignee' | 'milestone' | 'category', string> = {
  assignee: '未割り当て',
  milestone: 'マイルストーンなし',
  category: 'カテゴリなし'
}

/** ある軸から見た、課題の所属先 1 つぶん。 */
type GroupSlot = {
  /** 同じ階層の中で一意な断片。 */
  key: string
  label: string
  assigneeId: number | null
  /** 値が設定されていないことを表すグループかどうか。並び順で末尾へ送る。 */
  unset: boolean
}

/**
 * 1 つの軸について、課題が属するグループを返す。
 *
 * カテゴリとマイルストーンは 1 課題に複数付けられるため、複数返ることがある。
 * その場合、課題はそれぞれのグループに重複して現れる。
 */
function slotsOf(issue: GanttIssue, groupBy: GroupBy, projectNames: Record<number, string>): GroupSlot[] {
  if (groupBy === 'assignee') {
    const { assigneeId } = issue
    if (assigneeId === null) {
      return [{ key: UNSET_KEY, label: UNSET_LABELS.assignee, assigneeId: null, unset: true }]
    }
    return [{ key: `u${assigneeId}`, label: issue.assigneeName ?? UNSET_LABELS.assignee, assigneeId, unset: false }]
  }
  if (groupBy === 'project') {
    return [
      {
        key: `p${issue.projectId}`,
        label: projectNames[issue.projectId] ?? issue.projectKey,
        assigneeId: null,
        unset: false
      }
    ]
  }

  const names = groupBy === 'milestone' ? issue.milestoneNames : issue.categoryNames
  if (names.length === 0) {
    return [{ key: UNSET_KEY, label: UNSET_LABELS[groupBy], assigneeId: null, unset: true }]
  }
  return names.map((name) => ({ key: `n:${name}`, label: name, assigneeId: null, unset: false }))
}

/** グループキーで段の区切りに使う文字。 */
const KEY_SEPARATOR = '/'

/**
 * グループキーの断片から区切り文字を退避する。
 *
 * 断片にはカテゴリ名やマイルストーン名が入り、利用者が自由に付けられるため
 * 区切りの `/` を含みうる。退避しないと、たとえば「マイルストーン `A/n:B` ×
 * カテゴリ `C`」と「マイルストーン `A` × カテゴリ `B/n:C`」が同じキーになり、
 * 別のグループが折りたたみ状態を共有してしまう。
 *
 * 逃がし方は `shared/filter.ts` の `encodeNameList` と同じで、`\` を `\\` に、
 * 区切り文字を `\/` に置き換える。キーは表示にも URL にも出ないため、
 * 元へ戻す必要は無い（一意であればよい）。
 */
function escapeKeyPart(part: string): string {
  return part
    .split('\\')
    .join(String.raw`\\`)
    .split(KEY_SEPARATOR)
    .join(String.raw`\/`)
}

/** 組み立て途中のグループ。 */
type Bucket = {
  group: GanttGroup
  unset: boolean
  children: Map<string, Bucket>
  /** 配下に現れた課題 ID。複数の下位グループに属する課題を二重に数えないために持つ。 */
  seen: Set<number>
}

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

/** グループの並び順。「未割り当て」のような値なしのグループは末尾に置く。 */
function compareBuckets(a: Bucket, b: Bucket): number {
  if (a.unset !== b.unset) {
    return a.unset ? 1 : -1
  }
  return a.group.label.localeCompare(b.group.label, 'ja')
}

/** 課題を 1 件、`depth` 段目以降のグループへ振り分ける。 */
function insert(
  level: Map<string, Bucket>,
  parentKey: string,
  issue: GanttIssue,
  depth: number,
  axes: GroupBy[],
  today: string,
  projectNames: Record<number, string>
): void {
  const groupBy = axes[depth]
  const isLeaf = depth === axes.length - 1

  for (const slot of slotsOf(issue, groupBy, projectNames)) {
    const key = `${parentKey}${KEY_SEPARATOR}${escapeKeyPart(slot.key)}`
    let bucket = level.get(key)
    if (!bucket) {
      bucket = {
        group: {
          key,
          label: slot.label,
          groupBy,
          depth,
          children: [],
          issues: [],
          issueCount: 0,
          overdueCount: 0,
          assigneeId: slot.assigneeId
        },
        unset: slot.unset,
        children: new Map(),
        seen: new Set()
      }
      level.set(key, bucket)
    }

    // 同じ課題が別の経路で再びここへ来ることがある（カテゴリを 2 つ持つ課題が
    // どちらの枝からも同じプロジェクトへ集まる場合など）。件数も行も一度だけ。
    if (!bucket.seen.has(issue.id)) {
      bucket.seen.add(issue.id)
      bucket.group.issueCount += 1
      if (isOverdue(issue, today)) {
        bucket.group.overdueCount += 1
      }
      if (isLeaf) {
        bucket.group.issues.push(issue)
      }
    }

    if (!isLeaf) {
      insert(bucket.children, key, issue, depth + 1, axes, today, projectNames)
    }
  }
}

/** 組み立て途中の入れ物を、並べ替え済みの結果へ畳む。 */
function finalize(level: Map<string, Bucket>): GanttGroup[] {
  return [...level.values()].toSorted(compareBuckets).map((bucket) => {
    bucket.group.children = finalize(bucket.children)
    bucket.group.issues = bucket.group.issues.toSorted(compareIssues)
    return bucket.group
  })
}

/**
 * 課題を大項目から順にグルーピングし、木構造で返す。
 *
 * `groupBy` は大項目を先頭に並べた軸の列。`parseFilter`（`shared/filter.ts`）が
 * 1 つ以上・重複なし・上限段数以内に正してから渡すため、内容は検証しない。
 *
 * カテゴリとマイルストーンの軸では、複数の値を持つ課題はそれぞれのグループに
 * 重複して現れる（Backlog の仕様上ありうるため）。
 */
export function groupIssues(
  issues: GanttIssue[],
  groupBy: GroupBy[],
  today: string,
  projectNames: Record<number, string> = {}
): GanttGroup[] {
  // 軸が空だと `insert` の再帰に終わりが無く、スタックを使い切って画面が
  // 真っ白になる。呼び出し側が 1 つ以上を保証する取り決めだが、ここで
  // 空を返しておけば取り決めが破れても落ちるところまではいかない。
  if (groupBy.length === 0) {
    return []
  }
  const roots = new Map<string, Bucket>()
  for (const issue of issues) {
    insert(roots, '', issue, 0, groupBy, today, projectNames)
  }
  return finalize(roots)
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

/**
 * 今日を表す帯。線ではなく列そのものを塗るため、位置と幅を返す。
 *
 * 区切りはヘッダー下段の目盛りに合わせる。日ズームなら 1 日分、
 * それ以外は今日を含む 1 週間ぶん（表示期間で切り詰めたもの）になる。
 * 今日が表示期間の外にあれば null。
 */
export function todayBand(scale: TimelineScale, zoom: Zoom, today: string): TimelineTick | null {
  if (today < scale.from || today > scale.to) {
    return null
  }
  if (zoom === 'day') {
    return { key: today, label: '', left: xOf(today, scale), width: scale.pxPerDay }
  }
  const weekStart = startOfWeek(today)
  const visibleStart = clampDate(weekStart, scale.from, scale.to)
  const visibleEnd = clampDate(addDays(weekStart, 6), scale.from, scale.to)
  return {
    key: weekStart,
    label: '',
    left: xOf(visibleStart, scale),
    width: (diffDays(visibleStart, visibleEnd) + 1) * scale.pxPerDay
  }
}

/**
 * 祝日の帯（日ズームのときのみ意味を持つ）。
 *
 * 祝日の一覧はサーバーから受け取る。`label` に名称を入れており、
 * 帯そのものは装飾なので読み上げさせないが、ヘッダーの目盛りの
 * `title` に出して名称が分かるようにする。
 */
export function holidayBands(scale: TimelineScale, zoom: Zoom, holidays: readonly Holiday[]): TimelineTick[] {
  if (zoom !== 'day') {
    return []
  }
  return holidays
    .filter(({ dateKey }) => dateKey >= scale.from && dateKey <= scale.to)
    .map(({ dateKey, name }) => ({
      key: dateKey,
      label: name,
      left: xOf(dateKey, scale),
      width: scale.pxPerDay
    }))
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
  const hashed = Math.imul(projectId | 0, 2_654_435_761) >>> 0
  return PROJECT_COLORS[Math.floor((hashed / 0x1_00_00_00_00) * PROJECT_COLORS.length)]
}

/** Backlog がステータスに色を持たない場合のフォールバック。 */
export const FALLBACK_STATUS_COLOR = '#94a3b8'

/** バーの背景色。Backlog のガントチャートと同じくステータスの色を使う。 */
export function statusColor(issue: GanttIssue): string {
  return issue.statusColor ?? FALLBACK_STATUS_COLOR
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu

/** `#rgb` / `#rrggbb` を 0〜255 の RGB に分解する。解釈できなければ null。 */
function parseHexColor(color: string): [number, number, number] | null {
  if (!HEX_COLOR.test(color)) {
    return null
  }
  const hex = color.slice(1)
  // `#abc` を `#aabbcc` に展開する。直前の `HEX_COLOR.test` を通っているので
  // 中身は 16 進数字だけであり、添字で 1 文字ずつ見てよい。
  //
  // `replaceAll` は使わない。このモジュールは `src/shared/` にあり、サーバー側
  // （Apps Script の V8）のバンドルへも入りうる。V8 がどの ECMAScript 版まで
  // 含むかは公表されておらず、ES2021 の組み込みが在る保証がない。
  // `polyfill.ts` が補っているのは `toSorted` だけで、`smoke` は tree-shaking 後の
  // バンドルしか見られないため、サーバーが import した瞬間に実行時まで気づけない。
  const full = hex.length === 3 ? `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}` : hex
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
