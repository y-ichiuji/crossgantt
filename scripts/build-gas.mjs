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
 * HTML へ直接埋め込めない並びが無いことを確かめる。
 *
 * 埋め込む側の文字列を機械的に書き換えると、文字列リテラル以外の場所に
 * 現れた場合に意味を変えてしまう。自分たちのコードで避けられる問題なので、
 * 見つかったらビルドを止める。
 *
 * JavaScript は Base64 にして運ぶためこの検査を通さない。HtmlService は
 * ファイルの中身を HTML として解析するため、`i<n` のような比較演算子を
 * タグの開始と見なして内容を壊してしまう。Base64 には `<` も `&` も
 * 現れないので、解析されても変化しない。
 */
function assertEmbeddable(source, closing, file) {
  if (source.toLowerCase().includes(closing)) {
    throw new Error(`${file} に ${closing} が含まれており、HTML へ埋め込めません`)
  }
}

async function buildClient() {
  await viteBuild({ logLevel: 'warn' })

  const js = await readFile(path.join(CLIENT_DIR, 'app.js'), 'utf8')
  const css = await readFile(path.join(CLIENT_DIR, 'app.css'), 'utf8')

  assertEmbeddable(css, '</style', 'app.css')

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
