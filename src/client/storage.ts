/**
 * 接続情報（スペースドメインと API キー）のブラウザ保存。
 *
 * サーバーには一切保存せず、localStorage にのみ置く。
 * XSS が起きた場合に読み出されうる方式であるため、UI で注意喚起する。
 */

import type { Connection } from './api'

const STORAGE_KEY = 'crossgantt.connection.v1'

export function loadConnection(): Connection | null {
  if (typeof localStorage === 'undefined') {
    return null
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<Connection>
    if (typeof parsed.space !== 'string' || typeof parsed.apiKey !== 'string') {
      return null
    }
    if (!parsed.space || !parsed.apiKey) {
      return null
    }
    return { space: parsed.space, apiKey: parsed.apiKey }
  } catch {
    return null
  }
}

export function saveConnection(connection: Connection): void {
  if (typeof localStorage === 'undefined') {
    return
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(connection))
}

export function clearConnection(): void {
  if (typeof localStorage === 'undefined') {
    return
  }
  localStorage.removeItem(STORAGE_KEY)
}
