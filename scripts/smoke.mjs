/**
 * ビルド成果物（`gas-dist/`）の簡易検査。
 *
 * Apps Script の Web アプリは実際にデプロイしないと動かせないため、
 * ここでは「push すれば動く形になっているか」を確かめる。
 * とくに、Apps Script に無い機能をサーバー側のバンドルが使っていないかを見る。
 *
 * 使い方: node scripts/smoke.mjs [ディレクトリ]
 */

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const dir = process.argv[2] ?? 'gas-dist'

let failures = 0

async function check(name, fn) {
  try {
    await fn()
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures += 1
    console.log(`  FAIL ${name}`)
    console.log(`       ${error instanceof Error ? error.message : String(error)}`)
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function read(name) {
  return readFile(path.join(dir, name), 'utf8')
}

/**
 * Apps Script に存在しない機能。
 *
 * どれもブラウザや Node.js の機能で、Apps Script の V8 ランタイムには無い。
 * 使ってしまうと push は通るのに実行時に落ちるため、ここで止める。
 */
const FORBIDDEN_IN_SERVER = [
  { pattern: /\bfetch\(/u, name: 'fetch()', instead: 'UrlFetchApp（src/server/gas/runtime.ts）' },
  { pattern: /\bnew URL\(/u, name: 'new URL()', instead: 'src/server/fetcher.ts の buildUrl' },
  { pattern: /\bURLSearchParams\b/u, name: 'URLSearchParams', instead: 'src/server/fetcher.ts の encodeQuery' },
  { pattern: /\bsetTimeout\(/u, name: 'setTimeout()', instead: 'Utilities.sleep' },
  { pattern: /\bcrypto\./u, name: 'crypto', instead: 'Utilities.computeDigest' },
  { pattern: /\bTextEncoder\b/u, name: 'TextEncoder', instead: 'Utilities.newBlob' },
  { pattern: /\blocalStorage\b/u, name: 'localStorage', instead: 'PropertiesService' },
  { pattern: /\bdocument\./u, name: 'document', instead: 'HtmlService' },
  // ScriptApp に触れるだけで、承認スコープに「トリガーの管理」が加わる。
  // 利用者全員がそれを承認しないと画面が出ないため、使わない。
  { pattern: /\bScriptApp\b/u, name: 'ScriptApp', instead: 'スクリプトプロパティ（WEB_APP_URL）' }
]

/** Apps Script の V8 で解釈できる保証が無い構文。esbuild が落としているはず。 */
const FORBIDDEN_SYNTAX = [
  { pattern: /\?\./u, name: '?.（オプショナルチェーン）' },
  { pattern: /\?\?/u, name: '??（null 合体）' }
]

console.log(`smoke test against ${dir}/`)

await check('必要なファイルが揃っている', async () => {
  for (const name of ['appsscript.json', 'Code.js', 'index.html', 'app-js.html', 'app-css.html']) {
    const info = await stat(path.join(dir, name)).catch(() => null)
    assert(info !== null, `${name} が無い`)
    assert(info.size > 0, `${name} が空`)
  }
})

await check('マニフェストがウェブアプリとして公開する設定になっている', async () => {
  const manifest = JSON.parse(await read('appsscript.json'))
  assert(manifest.runtimeVersion === 'V8', `runtimeVersion=${manifest.runtimeVersion}`)
  assert(manifest.webapp !== undefined, 'webapp の設定が無い')
  // 利用者ごとにトークンを分けるため、必ずアクセスするユーザーとして実行する。
  assert(manifest.webapp.executeAs === 'USER_ACCESSING', `executeAs=${manifest.webapp.executeAs}`)
  assert(typeof manifest.webapp.access === 'string', 'access の設定が無い')
})

await check('Apps Script から呼べるトップレベル関数がある', async () => {
  const code = await read('Code.js')
  for (const name of ['doGet', 'apiCall', 'include']) {
    assert(new RegExp(String.raw`^function ${name}\(`, 'mu').test(code), `function ${name} が無い`)
  }
  assert(/^var CrossGantt = /mu.test(code), 'バンドルがグローバルへ束ねられていない')
})

await check('サーバー側が Apps Script に無い機能を使っていない', async () => {
  const code = await read('Code.js')
  for (const { pattern, name, instead } of FORBIDDEN_IN_SERVER) {
    assert(!pattern.test(code), `${name} を使っている（${instead} を使うこと）`)
  }
})

await check('サーバー側の構文が落とされている', async () => {
  const code = await read('Code.js')
  for (const { pattern, name } of FORBIDDEN_SYNTAX) {
    assert(!pattern.test(code), `${name} が残っている`)
  }
})

await check('新しい組み込みを補うコードが入っている', async () => {
  const code = await read('Code.js')
  // toSorted はコード全体で使っている。無い環境でも動くようにしておく。
  assert(code.includes('Array.prototype.toSorted'), 'toSorted のポリフィルが無い')
})

await check('画面のテンプレートが成り立っている', async () => {
  const html = await read('index.html')
  assert(html.includes('<div id="root"></div>'), 'マウント先の #root が無い')
  assert(html.includes("include('app-css')"), 'スタイルの差し込みが無い')
  assert(html.includes("include('app-js')"), 'スクリプトの差し込みが無い')
  assert(html.includes('id="crossgantt-bootstrap"'), '起動時設定の受け渡しが無い')
  assert(html.includes('crossgantt-app-source'), 'バンドルの読み込み処理が無い')
  // サンドボックス iframe の中では、既定の遷移先を最上位フレームにしておく。
  assert(html.includes('<base target="_top" />'), 'base target が無い')
})

/**
 * スクリプトレット（`<?= ?>` / `<?!= ?>`）を取り除く。
 *
 * これらは HtmlService に評価されて消えるため、検査の対象にしない。
 * 自分たちが書く小さなテンプレートだけを相手にするので、真面目な HTML
 * パーサは要らない。開始と終了の目印をそのまま文字列として探すだけで足りる。
 */
function stripScriptlets(html) {
  let result = ''
  let cursor = 0
  for (;;) {
    const open = html.indexOf('<?', cursor)
    if (open === -1) {
      result += html.slice(cursor)
      break
    }
    const close = html.indexOf('?>', open)
    if (close === -1) {
      result += html.slice(cursor, open)
      break
    }
    result += html.slice(cursor, open)
    cursor = close + 2
  }
  return result
}

/** `<script ...>...</script>`（大小文字・閉じタグ内の空白を問わない）の中身を列挙する。 */
function scriptBodies(html) {
  const bodies = []
  let cursor = 0
  const lower = html.toLowerCase()
  for (;;) {
    const open = lower.indexOf('<script', cursor)
    if (open === -1) {
      break
    }
    const headEnd = html.indexOf('>', open)
    const close = lower.indexOf('</script', headEnd)
    if (headEnd === -1 || close === -1) {
      break
    }
    bodies.push(html.slice(headEnd + 1, close))
    cursor = close + 1
  }
  return bodies
}

await check('テンプレートが HtmlService の解析で壊れない', async () => {
  const html = await read('index.html')
  // HtmlService はファイルの中身を HTML として解析する。タグに見える並びが
  // 中にあると、そこを境に内容を作り替えてしまう。テンプレート側に書く
  // スクリプトでは比較演算子の `<` を使わない。
  for (const body of scriptBodies(stripScriptlets(html))) {
    assert(!body.includes('<'), `テンプレート内のスクリプトに < がある: ${body.trim().slice(0, 40)}`)
  }
})

await check('クライアントのバンドルが Base64 で運ばれている', async () => {
  const rawJs = await read('app-js.html')
  const js = rawJs.trim()
  // 生の JavaScript を置くと、比較演算子の `<` をタグの開始と解釈されて壊される。
  // Base64 には `<` も `&` も現れないため、解析されても変化しない。
  const OPEN_TAG = '<div id="crossgantt-app-source" hidden>'
  const CLOSE_TAG = '</div>'
  assert(
    js.toLowerCase().startsWith(OPEN_TAG) && js.toLowerCase().endsWith(CLOSE_TAG),
    'Base64 を載せた div の形になっていない'
  )
  const encoded = js.slice(OPEN_TAG.length, js.length - CLOSE_TAG.length)
  assert(/^[A-Za-z0-9+/=]+$/u.test(encoded), 'Base64 以外の文字が混ざっている')

  const source = Buffer.from(encoded, 'base64').toString('utf8')
  // 起動時設定の受け取り口が、テンプレート側と同じ名前であること。
  assert(source.includes('crossgantt-bootstrap'), '起動時設定を読んでいない')
  // google.script.run 以外の経路でサーバーを呼んでいないこと。
  assert(source.includes('apiCall'), 'サーバー呼び出しが入っていない')
})

await check('スタイルが差し込める形になっている', async () => {
  const css = await read('app-css.html')
  assert(css.startsWith('<style>'), 'style タグで包まれていない')
  assert(css.trimEnd().endsWith('</style>'), 'style タグが閉じていない')
})

if (failures > 0) {
  console.error(`\n${failures} 件失敗しました`)
  process.exit(1)
}
console.log('\nすべて成功しました')
