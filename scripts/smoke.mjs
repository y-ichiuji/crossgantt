/**
 * ローカル開発サーバーに対する簡易スモークテスト。
 *
 * Backlog の実データを使わずに確認できる範囲（HTML の配信と
 * プロキシ API のガード）だけを検証する。
 *
 * 使い方: node scripts/smoke.mjs [baseUrl]
 */

const base = process.argv[2] ?? 'http://localhost:5173'

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

console.log(`smoke test against ${base}`)

await check('トップページが HTML を返す', async () => {
  const response = await fetch(`${base}/`)
  assert(response.status === 200, `status=${response.status}`)
  const html = await response.text()
  assert(html.includes('<div id="root"'), 'マウント先の #root が無い')
  assert(html.includes('CrossGantt for Backlog'), 'タイトルが無い')
  // 開発時は /src/client/index.tsx、本番はハッシュ付きのバンドルを読み込む。
  // どちらも無ければクライアントが起動せず真っ白になる。
  assert(
    /<script[^>]+src="(\/src\/client\/index\.tsx|\/assets\/[^"]+\.js)"/.test(html),
    'クライアントのスクリプトタグが無い'
  )
  assert(
    html.includes('/src/style.css') || /<link[^>]+href="\/assets\/[^"]+\.css"/.test(html),
    'スタイルシートの参照が無い'
  )
})

await check('スペース未指定の API は 400', async () => {
  const response = await fetch(`${base}/api/projects`, {
    headers: { 'X-Backlog-Api-Key': 'abcdefghijklmnop' }
  })
  assert(response.status === 400, `status=${response.status}`)
  assert(response.headers.get('cache-control') === 'no-store', 'Cache-Control が no-store でない')
})

await check('Backlog 以外のホストは 400 で拒否される', async () => {
  const response = await fetch(`${base}/api/projects`, {
    headers: { 'X-Backlog-Space': 'evil.example.com', 'X-Backlog-Api-Key': 'abcdefghijklmnop' }
  })
  assert(response.status === 400, `status=${response.status}`)
  const body = await response.json()
  assert(String(body.error).includes('スペースドメイン'), `error=${body.error}`)
})

await check('API キー未指定は 401', async () => {
  const response = await fetch(`${base}/api/projects`, {
    headers: { 'X-Backlog-Space': 'example.backlog.jp' }
  })
  assert(response.status === 401, `status=${response.status}`)
})

await check('/api/issues はプロジェクト未指定を 400 で弾く', async () => {
  const response = await fetch(`${base}/api/issues?from=2026-09-01&to=2026-09-30`, {
    headers: { 'X-Backlog-Space': 'example.backlog.jp', 'X-Backlog-Api-Key': 'abcdefghijklmnop' }
  })
  assert(response.status === 400, `status=${response.status}`)
})

await check('存在しないパスでもアプリの HTML を返す（SPA フォールバック）', async () => {
  const response = await fetch(`${base}/anything`)
  assert(response.status === 200, `status=${response.status}`)
})

if (failures > 0) {
  console.error(`\n${failures} 件失敗しました`)
  process.exit(1)
}
console.log('\nすべて成功しました')
