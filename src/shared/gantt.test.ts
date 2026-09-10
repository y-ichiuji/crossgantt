import { describe, expect, it } from 'vitest'

import {
  barGeometry,
  buildScale,
  filterByRange,
  groupIssues,
  hasNoDate,
  holidayBands,
  isOverdue,
  minorTicks,
  monthTicks,
  FALLBACK_STATUS_COLOR,
  PROJECT_COLORS,
  projectColor,
  readableTextColor,
  relativeLuminance,
  statusColor,
  resolveBar,
  summarize,
  todayBand,
  weekendBands,
  xOf
} from './gantt'
import type { GanttIssue } from './types'

const TODAY = '2026-09-10'

function makeIssue(overrides: Partial<GanttIssue> = {}): GanttIssue {
  return {
    id: 1,
    issueKey: 'PJA-1',
    summary: 'テスト課題',
    url: 'https://example.backlog.jp/view/PJA-1',
    projectId: 100,
    projectKey: 'PJA',
    assigneeId: 10,
    assigneeName: '山田太郎',
    statusId: 1,
    statusName: '未対応',
    statusColor: '#ed8077',
    isClosed: false,
    startDate: '2026-09-01',
    dueDate: '2026-09-15',
    estimatedHours: null,
    actualHours: null,
    parentIssueId: null,
    milestoneNames: [],
    ...overrides
  }
}

describe('resolveBar', () => {
  it('開始日と期限日があれば範囲バーになる', () => {
    expect(resolveBar(makeIssue(), TODAY)).toEqual({ kind: 'range', start: '2026-09-01', end: '2026-09-15' })
  })

  it('開始日と期限日が逆転していても順序を正す', () => {
    const bar = resolveBar(makeIssue({ startDate: '2026-09-20', dueDate: '2026-09-05' }), TODAY)
    expect(bar).toEqual({ kind: 'range', start: '2026-09-05', end: '2026-09-20' })
  })

  it('期限日のみならマーカーになる', () => {
    const bar = resolveBar(makeIssue({ startDate: null }), TODAY)
    expect(bar).toEqual({ kind: 'due-marker', start: '2026-09-15', end: '2026-09-15' })
  })

  it('開始日のみなら今日までのバーになる', () => {
    const bar = resolveBar(makeIssue({ dueDate: null }), TODAY)
    expect(bar).toEqual({ kind: 'open-ended', start: '2026-09-01', end: TODAY })
  })

  it('開始日が未来なら 1 日分のバーになる', () => {
    const bar = resolveBar(makeIssue({ startDate: '2026-09-20', dueDate: null }), TODAY)
    expect(bar).toEqual({ kind: 'open-ended', start: '2026-09-20', end: '2026-09-20' })
  })

  it('日付が無ければ null', () => {
    expect(resolveBar(makeIssue({ startDate: null, dueDate: null }), TODAY)).toBeNull()
  })
})

describe('isOverdue', () => {
  it('期限切れかつ未完了なら true', () => {
    expect(isOverdue(makeIssue({ dueDate: '2026-09-09' }), TODAY)).toBe(true)
  })

  it('期限が今日なら false', () => {
    expect(isOverdue(makeIssue({ dueDate: TODAY }), TODAY)).toBe(false)
  })

  it('完了済みなら false', () => {
    expect(isOverdue(makeIssue({ dueDate: '2026-09-09', isClosed: true }), TODAY)).toBe(false)
  })

  it('期限日が無ければ false', () => {
    expect(isOverdue(makeIssue({ dueDate: null }), TODAY)).toBe(false)
  })
})

describe('hasNoDate', () => {
  it('両方 null のときだけ true', () => {
    expect(hasNoDate(makeIssue({ startDate: null, dueDate: null }))).toBe(true)
    expect(hasNoDate(makeIssue({ startDate: null }))).toBe(false)
  })
})

describe('filterByRange', () => {
  const issues = [
    makeIssue({ id: 1, startDate: '2026-09-01', dueDate: '2026-09-05' }),
    makeIssue({ id: 2, startDate: '2026-01-01', dueDate: '2026-12-31' }),
    makeIssue({ id: 3, startDate: '2026-11-01', dueDate: '2026-11-10' }),
    makeIssue({ id: 4, startDate: null, dueDate: null })
  ]

  it('表示期間に重なる課題だけを残す', () => {
    const result = filterByRange(issues, '2026-09-01', '2026-09-30', TODAY)
    expect(result.map((issue) => issue.id)).toEqual([1, 2])
  })

  it('期間をまたぐ長期課題も含む', () => {
    const result = filterByRange(issues, '2026-06-01', '2026-06-30', TODAY)
    expect(result.map((issue) => issue.id)).toEqual([2])
  })
})

describe('groupIssues', () => {
  const issues = [
    makeIssue({ id: 1, assigneeId: 10, assigneeName: '山田太郎', projectId: 100, projectKey: 'PJA' }),
    makeIssue({ id: 2, assigneeId: 20, assigneeName: '佐藤花子', projectId: 200, projectKey: 'PJB' }),
    makeIssue({ id: 3, assigneeId: null, assigneeName: null, dueDate: '2026-09-01' })
  ]

  it('担当者別にまとめ、未割り当てを末尾に置く', () => {
    const groups = groupIssues(issues, 'assignee', TODAY)
    expect(groups.map((group) => group.label)).toEqual(['佐藤花子', '山田太郎', '未割り当て'])
  })

  it('遅延件数を数える', () => {
    const groups = groupIssues(issues, 'assignee', TODAY)
    const unassigned = groups.find((group) => group.label === '未割り当て')
    expect(unassigned?.overdueCount).toBe(1)
  })

  it('プロジェクト別ではプロジェクト名を使う', () => {
    const groups = groupIssues(issues, 'project', TODAY, { 100: 'プロジェクトA', 200: 'プロジェクトB' })
    expect(groups.map((group) => group.label)).toEqual(['プロジェクトA', 'プロジェクトB'])
  })

  it('プロジェクト名が無ければプロジェクトキーで代替する', () => {
    const groups = groupIssues([issues[0]], 'project', TODAY)
    expect(groups[0].label).toBe('PJA')
  })

  it('マイルストーン別では複数所属の課題が両方に現れる', () => {
    const multi = makeIssue({ id: 9, milestoneNames: ['v1.0', 'v1.1'] })
    const none = makeIssue({ id: 10, milestoneNames: [] })
    const groups = groupIssues([multi, none], 'milestone', TODAY)
    expect(groups.map((group) => group.label)).toEqual(['v1.0', 'v1.1', 'マイルストーンなし'])
    expect(groups[0].issues).toHaveLength(1)
    expect(groups[1].issues).toHaveLength(1)
  })

  it('グループ内は開始日順に並ぶ', () => {
    const groups = groupIssues(
      [
        makeIssue({ id: 1, assigneeId: 10, assigneeName: 'A', startDate: '2026-09-20' }),
        makeIssue({ id: 2, assigneeId: 10, assigneeName: 'A', startDate: '2026-09-01' })
      ],
      'assignee',
      TODAY
    )
    expect(groups[0].issues.map((issue) => issue.id)).toEqual([2, 1])
  })
})

describe('summarize', () => {
  it('件数を集計する', () => {
    const issues = [
      makeIssue({ id: 1, startDate: '2026-09-01', dueDate: '2026-09-05' }),
      makeIssue({ id: 2, dueDate: '2026-09-01', startDate: null }),
      makeIssue({ id: 3, startDate: null, dueDate: null }),
      makeIssue({ id: 4, startDate: '2026-12-01', dueDate: '2026-12-10' })
    ]
    expect(summarize(issues, '2026-09-01', '2026-09-30', TODAY)).toEqual({
      total: 4,
      overdue: 2,
      noDate: 1,
      inRange: 2
    })
  })
})

describe('タイムラインの座標計算', () => {
  const scale = buildScale('2026-09-01', '2026-09-30', 'day')

  it('スケールの幅は日数 × 1 日あたりのピクセル数', () => {
    expect(scale.days).toBe(30)
    expect(scale.width).toBe(30 * scale.pxPerDay)
  })

  it('xOf は開始日からの日数で位置を求める', () => {
    expect(xOf('2026-09-01', scale)).toBe(0)
    expect(xOf('2026-09-11', scale)).toBe(10 * scale.pxPerDay)
  })

  it('barGeometry は終端の当日分を含む', () => {
    const geometry = barGeometry({ kind: 'range', start: '2026-09-01', end: '2026-09-01' }, scale)
    expect(geometry).toEqual({ left: 0, width: scale.pxPerDay, clippedStart: false, clippedEnd: false })
  })

  it('表示期間からはみ出す分は切り詰めてフラグを立てる', () => {
    const geometry = barGeometry({ kind: 'range', start: '2026-08-01', end: '2026-10-31' }, scale)
    expect(geometry.left).toBe(0)
    expect(geometry.width).toBe(30 * scale.pxPerDay)
    expect(geometry.clippedStart).toBe(true)
    expect(geometry.clippedEnd).toBe(true)
  })
})

describe('目盛り', () => {
  it('monthTicks は月ごとに区切る', () => {
    const scale = buildScale('2026-09-15', '2026-11-10', 'week')
    const ticks = monthTicks(scale)
    expect(ticks.map((tick) => tick.label)).toEqual(['2026年9月', '2026年10月', '2026年11月'])
    expect(ticks[0].left).toBe(0)
    // 9/15〜9/30 の 16 日分
    expect(ticks[0].width).toBe(16 * scale.pxPerDay)
  })

  it('minorTicks は日ズームで 1 日ごとに出る', () => {
    const scale = buildScale('2026-09-01', '2026-09-03', 'day')
    expect(minorTicks(scale, 'day').map((tick) => tick.label)).toEqual(['1', '2', '3'])
  })

  it('minorTicks は週ズームで週ごとに出る', () => {
    const scale = buildScale('2026-09-01', '2026-09-21', 'week')
    const ticks = minorTicks(scale, 'week')
    expect(ticks[0].label).toBe('9/1')
    expect(ticks).toHaveLength(4)
  })

  it('weekendBands は日ズームのときだけ返る', () => {
    const scale = buildScale('2026-09-01', '2026-09-14', 'day')
    expect(weekendBands(scale, 'day')).toHaveLength(4)
    expect(weekendBands(scale, 'week')).toHaveLength(0)
  })
})

describe('holidayBands', () => {
  const GOLDEN_WEEK = [
    { dateKey: '2026-04-29', name: '昭和の日' },
    { dateKey: '2026-05-03', name: '憲法記念日' },
    { dateKey: '2026-05-04', name: 'みどりの日' },
    { dateKey: '2026-05-05', name: 'こどもの日' },
    { dateKey: '2026-05-06', name: '振替休日' }
  ]

  it('日ズームでは祝日を 1 日分の帯にする', () => {
    const scale = buildScale('2026-04-25', '2026-05-10', 'day')
    const bands = holidayBands(scale, 'day', GOLDEN_WEEK)
    expect(bands.map((band) => [band.key, band.label])).toEqual(
      GOLDEN_WEEK.map((holiday) => [holiday.dateKey, holiday.name])
    )
    expect(bands[0].left).toBe(4 * scale.pxPerDay)
    expect(bands[0].width).toBe(scale.pxPerDay)
  })

  it('表示期間の外にある祝日は落とす', () => {
    const scale = buildScale('2026-05-01', '2026-05-10', 'day')
    const bands = holidayBands(scale, 'day', GOLDEN_WEEK)
    expect(bands.map((band) => band.key)).toEqual(['2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06'])
  })

  it('週・月ズームでは出さない', () => {
    const scale = buildScale('2026-04-25', '2026-05-10', 'week')
    expect(holidayBands(scale, 'week', GOLDEN_WEEK)).toHaveLength(0)
    expect(holidayBands(scale, 'month', GOLDEN_WEEK)).toHaveLength(0)
  })

  it('祝日が無ければ空', () => {
    const scale = buildScale('2026-06-01', '2026-06-30', 'day')
    expect(holidayBands(scale, 'day', [])).toHaveLength(0)
  })
})

describe('todayBand', () => {
  const scale = buildScale('2026-09-01', '2026-09-30', 'day')

  it('日ズームでは今日 1 日分の列になる', () => {
    const band = todayBand(scale, 'day', '2026-09-10')
    expect(band).toEqual({
      key: '2026-09-10',
      label: '',
      left: 9 * scale.pxPerDay,
      width: scale.pxPerDay
    })
  })

  it('週ズームでは今日を含む 1 週間の列になる', () => {
    const weekScale = buildScale('2026-09-01', '2026-09-30', 'week')
    // 2026-09-10 は木曜。週の始まりは 9/7（月）。
    const band = todayBand(weekScale, 'week', '2026-09-10')
    expect(band?.key).toBe('2026-09-07')
    expect(band?.width).toBe(7 * weekScale.pxPerDay)
  })

  it('週の一部が表示期間の外なら、はみ出す分を切り詰める', () => {
    const weekScale = buildScale('2026-09-09', '2026-09-30', 'week')
    const band = todayBand(weekScale, 'week', '2026-09-10')
    // 9/7〜9/8 は表示期間の外なので 9/9〜9/13 の 5 日分。
    expect(band?.left).toBe(0)
    expect(band?.width).toBe(5 * weekScale.pxPerDay)
  })

  it('目盛りの区切りと一致するので、ヘッダー側の強調に使える', () => {
    const ticks = minorTicks(scale, 'day')
    const band = todayBand(scale, 'day', '2026-09-10')
    expect(ticks.some((tick) => tick.key === band?.key)).toBe(true)
  })

  it('今日が表示期間の外なら null', () => {
    expect(todayBand(scale, 'day', '2026-08-31')).toBeNull()
    expect(todayBand(scale, 'day', '2026-10-01')).toBeNull()
  })

  it('表示期間の端でも列を返す', () => {
    expect(todayBand(scale, 'day', '2026-09-01')?.left).toBe(0)
    expect(todayBand(scale, 'day', '2026-09-30')?.left).toBe(29 * scale.pxPerDay)
  })
})

describe('projectColor', () => {
  it('同じ ID なら常に同じ色になる', () => {
    expect(projectColor(123)).toBe(projectColor(123))
  })

  it('負の ID でも範囲内の色を返す', () => {
    expect(PROJECT_COLORS).toContain(projectColor(-7))
  })

  it('切りのよい ID どうしでも色が衝突しにくい', () => {
    const colors = [100, 200, 300, 400, 500].map(projectColor)
    expect(new Set(colors).size).toBeGreaterThanOrEqual(4)
  })
})

describe('statusColor', () => {
  it('Backlog のステータス色をそのまま使う', () => {
    expect(statusColor(makeIssue({ statusColor: '#4488c5' }))).toBe('#4488c5')
  })

  it('色が無ければフォールバックする', () => {
    expect(statusColor(makeIssue({ statusColor: null }))).toBe(FALLBACK_STATUS_COLOR)
  })
})

describe('relativeLuminance', () => {
  it('白は 1、黒は 0', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
  })

  it('3 桁の短縮形も扱える', () => {
    expect(relativeLuminance('#fff')).toBeCloseTo(relativeLuminance('#ffffff'), 5)
  })

  it('解釈できない色は暗いものとして扱う', () => {
    expect(relativeLuminance('rebeccapurple')).toBe(0)
    expect(relativeLuminance('')).toBe(0)
  })
})

describe('readableTextColor', () => {
  it('明るい背景には濃い文字を選ぶ', () => {
    // Backlog の「完了」の既定色。
    expect(readableTextColor('#b0be3c')).toBe('#1c2430')
    expect(readableTextColor('#ffffff')).toBe('#1c2430')
  })

  it('暗い背景には白い文字を選ぶ', () => {
    expect(readableTextColor('#000000')).toBe('#ffffff')
    expect(readableTextColor('#1f2937')).toBe('#ffffff')
  })

  it('中間の明るさでもコントラストの高い方を選ぶ', () => {
    // 輝度 0.18〜0.45 の色は、白文字だとコントラスト比が 3:1 を割り込む。
    // フォールバック色 #94a3b8 は白だと 2.56:1、濃色なら 6.09:1。
    expect(readableTextColor(FALLBACK_STATUS_COLOR)).toBe('#1c2430')
    // Backlog の「処理済み」の既定色。白だと 2.29:1 しかない。
    expect(readableTextColor('#eb9a2b')).toBe('#1c2430')
  })

  it('解釈できない色でも白い文字にフォールバックする', () => {
    expect(readableTextColor('not-a-color')).toBe('#ffffff')
  })
})

describe('groupIssues の担当者 ID', () => {
  it('担当者別のときはグループに担当者 ID が入る', () => {
    const groups = groupIssues([makeIssue({ assigneeId: 10, assigneeName: '山田太郎' })], 'assignee', TODAY)
    expect(groups[0].assigneeId).toBe(10)
  })

  it('未割り当てのグループは null', () => {
    const groups = groupIssues([makeIssue({ assigneeId: null, assigneeName: null })], 'assignee', TODAY)
    expect(groups[0].assigneeId).toBeNull()
  })

  it('プロジェクト別のときは null', () => {
    const groups = groupIssues([makeIssue()], 'project', TODAY)
    expect(groups[0].assigneeId).toBeNull()
  })
})
