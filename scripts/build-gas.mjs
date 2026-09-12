/**
 * Apps Script へ push できる形の成果物を組み立てる。
 *
 * 出力は `gas-dist/` で、clasp がそのまま押し上げられる構成になっている。
 *
 *   appsscript.json  マニフェスト（gas/ からのコピー）
 *   Code.js          サーバー側のバンドル（+ トップレベル関数）
 *   index.html       画面のテンプレート（gas/ からのコピー）
 *   app-css.html     クライアントのスタイル
 *   app-js.html      クライアントのバンドル
 *
 * クライアントは vite、サーバーは esbuild でまとめる。サーバー側を
 * esbuild にしているのは、Apps Script が ES モジュールを解釈できず、
 * 1 つのグローバルにまとめた IIFE へ落とす必要があるため。
 *
 * 使い方: node scripts/build-gas.mjs
 */

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { build as esbuild } from 'esbuild'
import { build as viteBuild } from 'vite'

/** 成果物の出力先。 */
const OUT_DIR = 'gas-dist'

/** Apps Script 側に置くファイルの元。 */
const GAS_DIR = 'gas'

/** クライアントのビルド結果。 */
const CLIENT_DIR = 'dist/client'

/**
 * クライアントのバンドルを載せる要素の id。
 *
 * `gas/index.html` の読み込み処理と合わせる必要がある。
 */
const SOURCE_ELEMENT_ID = 'crossgantt-app-source'

/**
 * Apps Script が実行時に解釈できる構文の目安。
 *
 * V8 ランタイムがどの ECMAScript 版まで含むかは公表されていないため、
 * 構文は広く通る範囲まで落とす。組み込み（`toSorted` など）の不足は
 * src/server/gas/polyfill.ts で補う。
 */
const SERVER_TARGET = 'es2019'

/**
 * Apps Script から呼ばれるトップレベル関数。
 *
 * `google.script.run` と `doGet` はグローバルの関数しか見つけられない。
 * バンドルは 1 つのグローバル（CrossGantt）にまとまるため、ここで橋渡しする。
 */
const ENTRY_POINTS = `
function doGet(e) {
  return CrossGantt.doGet(e);
}

function apiCall(name, paramsJson) {
  return CrossGantt.apiCall(name, paramsJson);
}

function include(name) {
  return CrossGantt.include(name);
}
`

const GENERATED_NOTE = '// scripts/build-gas.mjs が生成したファイルです。直接編集しないでください。'

/**
 * HTML へ直接埋め込めない文字が無いことを確かめる。
 *
 * HtmlService はファイルの中身を HTML として解析する。JavaScript では
 * `i<n` のような比較演算子をタグの開始と見なしてバンドルを黙って欠損させた
 * 実績があるため、JavaScript は Base64 にして運んでいる（Base64 には `<` も
 * `&` も現れないので解析されても変化しない）。
 *
 * CSS は読み込みを遅らせたくないので `<style>` へそのまま置くが、同じ理由で
 * `<` を 1 文字も含めない。`</style` だけを見ていると、
 * `@media (width < 700px)` や `url('data:image/svg+xml,<svg …>')` が
 * 検査を素通りして、本番でだけスタイルが途中で切れることになる。
 *
 * 埋め込む側の文字列を機械的に書き換えると、文字列リテラル以外の場所に
 * 現れた場合に意味を変えてしまう。自分たちのコードで避けられる問題なので、
 * 見つかったらビルドを止める。
 */
function assertEmbeddableCss(css) {
  const index = css.indexOf('<')
  if (index === -1) {
    return
  }
  const around = css.slice(Math.max(0, index - 40), index + 40)
  throw new Error(
    [
      `app.css に < が含まれており、HTML へ埋め込めません（位置 ${index}）。`,
      `該当箇所: ${around}`,
      '範囲構文は max-width / min-width で書き換え、SVG を埋め込む場合は Base64 にしてください。'
    ].join('\n')
  )
}

async function buildClient() {
  await viteBuild({ logLevel: 'warn' })

  const js = await readFile(path.join(CLIENT_DIR, 'app.js'), 'utf8')
  const css = await readFile(path.join(CLIENT_DIR, 'app.css'), 'utf8')

  assertEmbeddableCss(css)

  // JavaScript をそのまま置くと HtmlService に壊される。Base64 で運ぶ。
  const encoded = Buffer.from(js, 'utf8').toString('base64')
  await writeFile(path.join(OUT_DIR, 'app-js.html'), `<div id="${SOURCE_ELEMENT_ID}" hidden>${encoded}</div>\n`)
  await writeFile(path.join(OUT_DIR, 'app-css.html'), `<style>\n${css}\n</style>\n`)
}

async function buildServer() {
  const result = await esbuild({
    entryPoints: ['src/server/gas/main.ts'],
    bundle: true,
    format: 'iife',
    globalName: 'CrossGantt',
    target: SERVER_TARGET,
    platform: 'neutral',
    minify: false,
    legalComments: 'none',
    write: false
  })

  const [output] = result.outputFiles
  await writeFile(path.join(OUT_DIR, 'Code.js'), `${GENERATED_NOTE}\n\n${output.text}\n${ENTRY_POINTS}`)
}

await rm(OUT_DIR, { recursive: true, force: true })
await mkdir(OUT_DIR, { recursive: true })

await cp(path.join(GAS_DIR, 'appsscript.json'), path.join(OUT_DIR, 'appsscript.json'))
await cp(path.join(GAS_DIR, 'index.html'), path.join(OUT_DIR, 'index.html'))

await buildServer()
await buildClient()

console.log(`${OUT_DIR}/ を生成しました`)
