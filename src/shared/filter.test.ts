import { describe, expect, it } from 'vitest'

import { defaultFilter, defaultRange, fetchKey, filterToParams, parseFilter } from './filter'
import type { ViewFilter } from './types'

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
})

describe('filterToParams', () => {
  it('既定値と同じ項目は省略する', () => {
    expect(filterToParams(defaultFilter(NOW), NOW).toString()).toBe('')
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

describe('fetchKey', () => {
  it('グルーピングとズームの変更では変わらない', () => {
    const base = defaultFilter(NOW)
    const changed: ViewFilter = { ...base, groupBy: 'project', zoom: 'day' }
    expect(fetchKey(changed)).toBe(fetchKey(base))
  })

  it('取得条件が変われば変わる', () => {
    const base = defaultFilter(NOW)
    expect(fetchKey({ ...base, projectIds: [1] })).not.toBe(fetchKey(base))
  })

  it('取得条件が同じなら順序が違っても同じキーになる', () => {
    const base = defaultFilter(NOW)
    expect(fetchKey({ ...base, projectIds: [1, 2] })).toBe(fetchKey({ ...base, projectIds: [1, 2] }))
  })
})
