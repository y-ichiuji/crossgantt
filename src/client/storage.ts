/**
 * ブラウザに保存する軽い設定。
 *
 * アクセストークンはサーバーの `UserProperties` にだけ置き、ブラウザへは
 * 一切渡らない（`src/server/auth/session.ts`）。ここに保存するのは
 * 「前回入力したスペースドメイン」だけで、秘密情報は置かない。
 *
 * `localStorage` の有無を調べる `typeof` も try の中に入れている。この画面は
 * HtmlService のサンドボックス iframe、つまり別サイト扱いの文脈で動くため、
 * サードパーティのストレージが遮断されていると参照そのものが SecurityError を
 * 投げる。`typeof` が守ってくれるのは未宣言の識別子だけで、グローバルの
 * プロパティとして解決される値のゲッターは実行される。
 */

const LAST_SPACE_KEY = 'crossgantt.lastSpace'

export function loadLastSpace(): string {
  try {
    if (typeof localStorage === 'undefined') {
      return ''
    }
    return localStorage.getItem(LAST_SPACE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveLastSpace(space: string): void {
  try {
    if (typeof localStorage === 'undefined') {
      return
    }
    localStorage.setItem(LAST_SPACE_KEY, space)
  } catch {
    // プライベートブラウジングなどで書き込めない場合は諦める。
  }
}
