/**
 * ブラウザに保存する軽い設定。
 *
 * 認証情報は HttpOnly Cookie とサーバー側のセッションで扱うため、
 * ここに保存するのは「前回入力したスペースドメイン」だけ。
 * 秘密情報は一切置かない。
 */

const LAST_SPACE_KEY = 'crossgantt.lastSpace'

export function loadLastSpace(): string {
  if (typeof localStorage === 'undefined') {
    return ''
  }
  try {
    return localStorage.getItem(LAST_SPACE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveLastSpace(space: string): void {
  if (typeof localStorage === 'undefined') {
    return
  }
  try {
    localStorage.setItem(LAST_SPACE_KEY, space)
  } catch {
    // プライベートブラウジングなどで書き込めない場合は諦める。
  }
}
