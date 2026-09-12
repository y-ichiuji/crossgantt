import { describe, expect, it } from 'vitest'

import { diffDays } from './date'
import { clampRange, defaultFilter, defaultRange, filterToQuery, MAX_RANGE_DAYS, parseFilter } from './filter'

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
    expect(parseFilter('', NOW)).toEqual(defaultFilter(NOW))
  })

  it('ID リストを数値配列として読む', () => {
    const filter = parseFilter('projects=3,1,3&assignees=9', NOW)
    expect(filter.projectIds).toEqual([1, 3])
    expect(filter.assigneeIds).toEqual([9])
  })

  it('不正な ID は捨てる', () => {
    const filter = parseFilter('projects=abc,-1,0,5', NOW)
    expect(filter.projectIds).toEqual([5])
  })

  it('不正な日付は既定値にフォールバックする', () => {
    const filter = parseFilter('from=2026-99-99&to=2026-10-31', NOW)
    expect(filter.from).toBe('2026-09-01')
    expect(filter.to).toBe('2026-10-31')
  })

  it('期間が逆転していたら終了日を開始日に合わせる', () => {
    const filter = parseFilter('from=2026-10-01&to=2026-09-01', NOW)
    expect(filter.from).toBe('2026-10-01')
    expect(filter.to).toBe('2026-10-01')
  })

  it('不正な列挙値は既定値になる', () => {
    const filter = parseFilter('group=unknown&zoom=year', NOW)
    expect(filter.groupBy).toBe('project')
    expect(filter.zoom).toBe('day')
  })

  it('真偽値を読む', () => {
    const filter = parseFilter('closed=1&nodate=true', NOW)
    expect(filter.includeClosed).toBe(true)
    expect(filter.includeNoDate).toBe(true)
  })

  it('長すぎる期間は上限まで詰める', () => {
    // 日ズームでは 1 日ごとに DOM を作るため、上限が無いと共有 URL 1 本で
    // ブラウザが数百万ノードを生成して固まる。
    const filter = parseFilter('from=2000-01-01&to=2999-12-31', NOW)
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

describe('filterToQuery', () => {
  it('既定値と同じ項目は省略する（ただし表示期間は必ず書き出す）', () => {
    const base = defaultFilter(NOW)
    // 既定の期間は「今日」を基準に計算されるため、省略すると URL の意味が
    // 開いた日によって変わってしまい、共有相手が別の期間を見ることになる。
    expect(filterToQuery(base, NOW)).toBe(`from=${base.from}&to=${base.to}`)
  })

  it('共有 URL は日付をまたいでも同じ期間を指す', () => {
    const base = defaultFilter(NOW)
    const query = filterToQuery(base, NOW)
    const oneMonthLater = NOW + 31 * 24 * 60 * 60 * 1000
    // 受け取った側の「今日」が違っても、書き出された期間がそのまま復元される。
    expect(parseFilter(query, oneMonthLater).from).toBe(base.from)
    expect(parseFilter(query, oneMonthLater).to).toBe(base.to)
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
    expect(parseFilter(filterToQuery(filter, NOW), NOW)).toEqual(filter)
  })

  it('共有 URL が doGet の復号を挟んでも往復できる', () => {
    // Apps Script は `event.parameter` の時点で 1 度復号し、`toQueryString` が
    // 組み直して画面へ渡す。その往復を模す。
    const filter = {
      ...defaultFilter(NOW),
      projectIds: [100, 200],
      statusNames: ['レビュー中（PR作成済み, 未マージ）', '未対応'],
      keyword: 'a b & c'
    }
    const shared = filterToQuery(filter, NOW)

    const decodedParams: Record<string, string> = {}
    for (const part of shared.split('&')) {
      const separator = part.indexOf('=')
      decodedParams[decodeURIComponent(part.slice(0, separator))] = decodeURIComponent(part.slice(separator + 1))
    }
    const rebuilt = Object.entries(decodedParams)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&')

    expect(parseFilter(rebuilt, NOW)).toEqual(filter)
  })

  it('区切り文字や記号を含むステータス名も往復できる', () => {
    // ステータス名は Backlog の管理者が自由に付けられるため、区切りに使う
    // `,` や、クエリで意味を持つ `&` `=` `%` が現れうる。
    const filter = {
      ...defaultFilter(NOW),
      projectIds: [1],
      statusNames: ['レビュー中（PR作成済み, 未マージ）', 'A&B', '100%完了', String.raw`C:\path, D`]
    }
    expect(parseFilter(filterToQuery(filter, NOW), NOW).statusNames).toEqual(filter.statusNames)
  })

  it('キーワードに空白や記号が入っても往復できる', () => {
    const filter = { ...defaultFilter(NOW), keyword: 'a b & c=d' }
    expect(parseFilter(filterToQuery(filter, NOW), NOW).keyword).toBe(filter.keyword)
  })

  it('URLSearchParams が書いた空白入りの保存済みクエリも読める', () => {
    // 以前は `URLSearchParams` が組み立てていたため、空白が `+` になっている
    // 値が IndexedDB に残っている。
    expect(parseFilter('keyword=a+b&from=2026-10-01&to=2026-11-30', NOW).keyword).toBe('a b')
  })
})
