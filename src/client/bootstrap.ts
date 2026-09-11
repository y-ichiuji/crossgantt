/**
 * 画面の起動時にサーバーから渡される設定の受け取り。
 *
 * Apps Script の Web アプリはサンドボックス iframe の中で動くため、
 * 表示中の URL からは初期表示条件を読み取れない。`doGet` が HTML を
 * 組み立てるときに埋め込んだ値をここで受け取る。
 *
 * ローカルの `vite dev` では埋め込みが無いため、URL のクエリだけを見る。
 * この状態では API もログインも動かないが、画面の見た目は確認できる。
 */

import type { Bootstrap } from '../shared/types'

/**
 * `index.html` が設定を載せる要素の id。
 *
 * `<script type="application/json">` に入れるのは、JavaScript として
 * 解釈させないためである。値が壊れていても構文エラーで画面ごと死ぬことがなく、
 * 既定値へ落とせる。
 */
export const BOOTSTRAP_ELEMENT_ID = 'crossgantt-bootstrap'

/** 埋め込まれた設定を読む。無い場合や壊れている場合は null。 */
function readInjected(): Bootstrap | null {
  if (typeof document === 'undefined') {
    return null
  }
  const element = document.getElementById(BOOTSTRAP_ELEMENT_ID)
  if (!element?.textContent) {
    return null
  }
  try {
    return JSON.parse(element.textContent) as Bootstrap
  } catch {
    return null
  }
}

function currentSearch(): string {
  if (typeof window === 'undefined') {
    return ''
  }
  return window.location.search.replace(/^\?/u, '')
}

let cached: Bootstrap | null = null

/** 埋め込まれた設定。無い場合はローカル開発向けの既定値。 */
export function loadBootstrap(): Bootstrap {
  if (cached) {
    return cached
  }
  cached = readInjected() ?? {
    webAppUrl: '',
    query: currentSearch(),
    configured: false,
    clientId: '',
    redirectUri: '',
    nonce: '',
    authError: null
  }
  return cached
}

/**
 * 共有用の URL。
 *
 * 画面が動いているのはサンドボックス iframe の中なので、`location.href` を
 * そのままコピーしても他の人が開ける URL にはならない。Web アプリの URL に
 * 表示条件のクエリを付けて組み立てる。
 */
export function buildShareUrl(query: string): string {
  const base = loadBootstrap().webAppUrl || (typeof window === 'undefined' ? '' : window.location.origin)
  return query === '' ? base : `${base}?${query}`
}

/** テスト用に読み込み済みの設定を捨てる。 */
export function resetBootstrap(): void {
  cached = null
}
