/**
 * 組み立て済みの `gas-dist/` を clasp で Apps Script へ反映する。
 *
 * デプロイ ID を指定すると、既存のデプロイを更新する（= /exec の URL が
 * 変わらない）。URL が変わると Backlog に登録したリダイレクト URI と
 * 一致しなくなりログインできなくなるため、運用では 1 つのデプロイを
 * 使い続けるのが前提になる。
 *
 * 必要な設定:
 *   .clasp.json        scriptId と rootDir。無い場合は GAS_SCRIPT_ID から作る
 *   GAS_DEPLOYMENT_ID  更新するデプロイの ID（未指定なら新しく作る）
 *
 * 使い方: node scripts/deploy-gas.mjs
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'

const CLASP_CONFIG = '.clasp.json'
const ROOT_DIR = 'gas-dist'

function fail(message) {
  console.error(message)
  process.exit(1)
}

/** clasp を 1 回実行する。失敗したらそこで止める。 */
function clasp(args) {
  console.log(`$ clasp ${args.join(' ')}`)
  const result = spawnSync('pnpm', ['exec', 'clasp', ...args], { stdio: 'inherit' })
  if (result.error) {
    fail(`clasp の起動に失敗しました: ${result.error.message}`)
  }
  if (result.status !== 0) {
    fail(`clasp ${args[0]} が失敗しました（終了コード ${result.status}）`)
  }
}

if (!existsSync(ROOT_DIR)) {
  fail(`${ROOT_DIR}/ がありません。先に pnpm run build を実行してください`)
}

// 存在を確かめてから書くと、その間に作られた設定を上書きしてしまう。
// `wx` なら「無ければ作る」が 1 回の操作で済む。
const scriptId = process.env.GAS_SCRIPT_ID
if (scriptId) {
  try {
    await writeFile(CLASP_CONFIG, `${JSON.stringify({ scriptId, rootDir: ROOT_DIR }, null, 2)}\n`, { flag: 'wx' })
    console.log(`${CLASP_CONFIG} を GAS_SCRIPT_ID から生成しました`)
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error
    }
  }
}

// 読めなければ、この先 clasp が何も特定できない。先に理由を示して止める。
try {
  await readFile(CLASP_CONFIG, 'utf8')
} catch {
  fail(
    `${CLASP_CONFIG} がありません。` +
      '.clasp.json.example をコピーして scriptId を埋めるか、環境変数 GAS_SCRIPT_ID を設定してください'
  )
}

const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const description = `CrossGantt ${version}`

clasp(['push', '--force'])

const deploymentId = process.env.GAS_DEPLOYMENT_ID
if (deploymentId) {
  clasp(['create-deployment', '--deploymentId', deploymentId, '--description', description])
} else if (process.env.GAS_ALLOW_NEW_DEPLOYMENT === '1') {
  console.warn('新しいデプロイを作ります。ウェブアプリの URL が変わるので、以降の設定を更新してください')
  clasp(['create-deployment', '--description', description])
} else {
  // 新しいデプロイを作ると /exec の URL が変わり、Backlog に登録した
  // リダイレクト URI と食い違ってログインできなくなる。事故を防ぐため、
  // 更新先が分からない状態では止める。
  fail(
    'GAS_DEPLOYMENT_ID が未設定です。更新するデプロイの ID を指定してください:\n' +
      '  GAS_DEPLOYMENT_ID=<デプロイ ID> pnpm run deploy\n' +
      'ID は pnpm exec clasp list-deployments で確認できます。\n' +
      '初回のように新しいデプロイを作ってよい場合は GAS_ALLOW_NEW_DEPLOYMENT=1 を付けてください。'
  )
}

console.log('デプロイしました')
