/**
 * HtmlService による画面の配信。
 *
 * `index.html` はテンプレートとして評価し、`app.css` と `app.js` は
 * そのまま差し込む。差し込む側をテンプレートにしないのは、最小化された
 * バンドルに `<?` が現れた場合にスクリプトレットとして解釈されるのを
 * 避けるためである（`createHtmlOutputFromFile` は評価しない）。
 */

import type { Bootstrap } from '../../shared/types'

const APP_TITLE = 'CrossGantt for Backlog'

/** テンプレートへ渡す値。 */
type AppTemplate = GoogleAppsScript.HTML.HtmlTemplate & { bootstrap: string }

/** テンプレートから他のファイルの中身を差し込む。グローバル関数として公開する。 */
export function include(name: string): string {
  return HtmlService.createHtmlOutputFromFile(name).getContent()
}

/**
 * 画面の HTML を組み立てる。
 *
 * `<meta>` や `<title>` はテンプレート内に書いても取り除かれるため、
 * HtmlOutput 側の API で指定する。
 */
export function renderApp(bootstrap: Bootstrap): GoogleAppsScript.HTML.HtmlOutput {
  const template = HtmlService.createTemplateFromFile('index') as AppTemplate
  // `<script>` の中へ埋めるため、閉じタグやコメント開始として解釈されうる
  // `<` を必ずエスケープしておく。
  template.bootstrap = JSON.stringify(bootstrap)
    .split('<')
    .join(String.raw`\u003c`)
  return template
    .evaluate()
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT)
}
