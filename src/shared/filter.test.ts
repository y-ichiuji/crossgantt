import { describe, expect, it } from 'vitest'

import { diffDays } from './date'
import { clampRange, defaultFilter, defaultRange, filterToParams, MAX_RANGE_DAYS, parseFilter } from './filter'

const NOW = Date.parse('2026-09-10T03:00:00Z')

describe('defaultFilter', () => {
  it('既定はプロジェクト別・日ズーム', () => {
    const filter = defaultFilter(NOW)
    expect(filter.groupBy).toBe('project')
    expect(filter.zoom).toBe('day')
  })

  it('既定では完了と日付未設定を含めない', () => {
    const filter = defaultFilter(NOW)
    expect(filter.includeClosed).toBe(false)
    expect(filter.includeNoDate).toBe(false)
  })
})

describe('defaultRange', () => {
  it('今月 1 日から 3 か月後の末日まで', () => {
    expect(defaultRange(NOW)).toEqual({ from: '2026-09-01', to: '2026-12-31' })
  })
})

describe('parseFilter', () => {
  it('空のクエリなら既定値を返す', () => {
    expect(parseFilter(new URLSearchParams(), NOW)).toEqual(defaultFilter(NOW))
  })

  it('ID リストを数値配列として読む', () => {
    const filter = parseFilter(new URLSearchParams('projects=3,1,3&assignees=9'), NOW)
    expect(filter.projectIds).toEqual([1, 3])
    expect(filter.assigneeIds).toEqual([9])
  })

  it('不正な ID は捨てる', () => {
    const filter = parseFilter(new URLSearchParams('projects=abc,-1,0,5'), NOW)
    expect(filter.projectIds).toEqual([5])
  })

  it('不正な日付は既定値にフォールバックする', () => {
    const filter = parseFilter(new URLSearchParams('from=2026-99-99&to=2026-10-31'), NOW)
    expect(filter.from).toBe('2026-09-01')
    expect(filter.to).toBe('2026-10-31')
  })

  it('期間が逆転していたら終了日を開始日に合わせる', () => {
    const filter = parseFilter(new URLSearchParams('from=2026-10-01&to=2026-09-01'), NOW)
    expect(filter.from).toBe('2026-10-01')
    expect(filter.to).toBe('2026-10-01')
  })

  it('不正な列挙値は既定値になる', () => {
    const filter = parseFilter(new URLSearchParams('group=unknown&zoom=year'), NOW)
    expect(filter.groupBy).toBe('project')
    expect(filter.zoom).toBe('day')
  })

  it('真偽値を読む', () => {
    const filter = parseFilter(new URLSearchParams('closed=1&nodate=true'), NOW)
    expect(filter.includeClosed).toBe(true)
    expect(filter.includeNoDate).toBe(true)
  })

  it('長すぎる期間は上限まで詰める', () => {
    // 日ズームでは 1 日ごとに DOM を作るため、上限が無いと共有 URL 1 本で
    // ブラウザが数百万ノードを生成して固まる。
    const filter = parseFilter(new URLSearchParams('from=2000-01-01&to=2999-12-31'), NOW)
    expect(filter.from).toBe('2000-01-01')
    expect(diffDays(filter.from, filter.to) + 1).toBe(MAX_RANGE_DAYS)
  })
})

describe('clampRange', () => {
  it('逆転した期間は開始日に合わせる', () => {
    expect(clampRange('2026-10-01', '2026-09-01')).toEqual({ from: '2026-10-01', to: '2026-10-01' })
  })

  it('上限以内ならそのまま返す', () => {
    expect(clampRange('2026-09-01', '2026-12-31')).toEqual({ from: '2026-09-01', to: '2026-12-31' })
  })
})

describe('filterToParams', () => {
  it('既定値と同じ項目は省略する（ただし表示期間は必ず書き出す）', () => {
    const base = defaultFilter(NOW)
    // 既定の期間は「今日」を基準に計算されるため、省略すると URL の意味が
    // 開いた日によって変わってしまい、共有相手が別の期間を見ることになる。
    expect(filterToParams(base, NOW).toString()).toBe(`from=${base.from}&to=${base.to}`)
  })

  it('共有 URL は日付をまたいでも同じ期間を指す', () => {
    const base = defaultFilter(NOW)
    const params = filterToParams(base, NOW)
    const oneMonthLater = NOW + 31 * 24 * 60 * 60 * 1000
    // 受け取った側の「今日」が違っても、書き出された期間がそのまま復元される。
    expect(parseFilter(params, oneMonthLater).from).toBe(base.from)
    expect(parseFilter(params, oneMonthLater).to).toBe(base.to)
  })

  it('往復しても内容が保たれる', () => {
    const filter = {
      ...defaultFilter(NOW),
      projectIds: [1, 2],
      assigneeIds: [10],
      statusNames: ['未対応', '処理中'],
      from: '2026-10-01',
      to: '2026-11-30',
      keyword: 'API',
      groupBy: 'project' as const,
      zoom: 'day' as const,
      includeClosed: true,
      includeNoDate: true
    }
    const params = filterToParams(filter, NOW)
    expect(parseFilter(params, NOW)).toEqual(filter)
  })
})
