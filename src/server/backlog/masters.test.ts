import { describe, expect, it } from 'vitest'

import type { BacklogStatus } from './api-types'
import { groupStatuses, resolveStatusIds } from './masters'

function status(id: number, projectId: number, name: string, displayOrder: number): BacklogStatus {
  return { id, projectId, name, color: '#ed8077', displayOrder }
}

describe('groupStatuses', () => {
  it('同名ステータスをプロジェクト横断で束ねる', () => {
    const groups = groupStatuses([
      status(1, 100, '未対応', 1000),
      status(1, 200, '未対応', 1000),
      status(4, 100, '完了', 4000),
      status(9, 200, 'レビュー中', 2500)
    ])

    expect(groups.map((group) => group.name)).toEqual(['未対応', 'レビュー中', '完了'])
    expect(groups[0].ids).toEqual([1])
    expect(groups[1].ids).toEqual([9])
  })

  it('同名でも ID が違えば両方保持する', () => {
    const groups = groupStatuses([status(5, 100, 'レビュー中', 2000), status(7, 200, 'レビュー中', 2100)])
    expect(groups[0].ids).toEqual([5, 7])
  })

  it('完了フラグを立てる', () => {
    const groups = groupStatuses([status(1, 100, '未対応', 1000), status(4, 100, '完了', 4000)])
    expect(groups.find((group) => group.name === '完了')?.isClosed).toBe(true)
    expect(groups.find((group) => group.name === '未対応')?.isClosed).toBe(false)
  })

  it('表示順は displayOrder の最小値に従う', () => {
    const groups = groupStatuses([status(9, 200, 'B', 500), status(1, 100, 'A', 3000), status(1, 300, 'A', 100)])
    expect(groups.map((group) => group.name)).toEqual(['A', 'B'])
  })
})

describe('resolveStatusIds', () => {
  const groups = groupStatuses([
    status(1, 100, '未対応', 1000),
    status(2, 100, '処理中', 2000),
    status(4, 100, '完了', 4000),
    status(9, 200, '未対応', 1000)
  ])

  it('未選択かつ完了を含めない場合は完了以外の全 ID を返す', () => {
    expect(resolveStatusIds(groups, [], false)).toEqual([1, 2, 9])
  })

  it('未選択かつ完了を含める場合は全 ID を返す', () => {
    expect(resolveStatusIds(groups, [], true)).toEqual([1, 2, 4, 9])
  })

  it('選択された名前に対応する ID をプロジェクト横断で展開する', () => {
    expect(resolveStatusIds(groups, ['未対応'], false)).toEqual([1, 9])
  })

  it('名前で明示的に選ばれた完了ステータスは、完了を含めない設定でも残す', () => {
    // 「完了を含む」は明示的な選択が無いときの既定を決めるもの。
    // ここで選択を打ち消すと ID が空になり、呼び出し元が 0 件を返して
    // 「条件に合う課題が無い」と区別できなくなる。
    expect(resolveStatusIds(groups, ['完了'], false)).toEqual([4])
  })

  it('選択が無いときは完了を含めない設定に従って完了を除く', () => {
    expect(resolveStatusIds(groups, [], false)).not.toContain(4)
    expect(resolveStatusIds(groups, [], true)).toContain(4)
  })

  it('存在しない名前は無視する', () => {
    expect(resolveStatusIds(groups, ['未対応', '存在しない'], false)).toEqual([1, 9])
  })
})
