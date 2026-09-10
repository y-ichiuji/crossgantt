/**
 * 起動中のサーバーに対する簡易スモークテスト。
 *
 * Backlog の実データや実際のログインは使わず、ログイン前の状態で
 * 確認できる範囲（HTML の配信、認証ガード、認可リダイレクト）だけを検証する。
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

await check('未ログインでは /api/auth/session が 401', async () => {
  const response = await fetch(`${base}/api/auth/session`)
  assert(response.status === 401, `status=${response.status}`)
  assert(response.headers.get('cache-control') === 'no-store', 'Cache-Control が no-store でない')
})

await check('未ログインではプロキシ API が 401', async () => {
  const response = await fetch(`${base}/api/projects`)
  assert(response.status === 401, `status=${response.status}`)
  assert(response.headers.get('cache-control') === 'no-store', 'Cache-Control が no-store でない')
})

await check('/api/issues も未ログインなら 401（パラメータ検証より前に弾く）', async () => {
  const response = await fetch(`${base}/api/issues?projectIds=1&from=2026-09-01&to=2026-09-30`)
  assert(response.status === 401, `status=${response.status}`)
})

await check('スペース未指定のログインは 400', async () => {
  const response = await fetch(`${base}/api/auth/login`, { redirect: 'manual' })
  assert(response.status === 400, `status=${response.status}`)
})

await check('Backlog 以外のドメインでのログインは 400 で拒否される', async () => {
  const response = await fetch(`${base}/api/auth/login?space=evil.example.com`, { redirect: 'manual' })
  assert(response.status === 400, `status=${response.status}`)
  const body = await response.json()
  assert(String(body.error).includes('スペースドメイン'), `error=${body.error}`)
})

await check('正しいスペースなら Backlog の認可画面へリダイレクトする', async () => {
  const response = await fetch(`${base}/api/auth/login?space=example.backlog.jp`, { redirect: 'manual' })
  if (response.status === 500) {
    throw new Error('OAuth の設定（BACKLOG_CLIENT_ID / BACKLOG_CLIENT_SECRET）が未設定です')
  }
  assert(response.status === 302, `status=${response.status}`)
  const location = new URL(response.headers.get('location'))
  assert(location.origin === 'https://example.backlog.jp', `origin=${location.origin}`)
  assert(location.pathname === '/OAuth2AccessRequest.action', `pathname=${location.pathname}`)
  assert(location.searchParams.get('response_type') === 'code', 'response_type が code でない')
  assert(location.searchParams.get('state'), 'state が付いていない')
  const setCookie = response.headers.get('set-cookie') ?? ''
  assert(setCookie.includes('cg_oauth_state='), 'state の Cookie が設定されていない')
  assert(setCookie.includes('HttpOnly'), 'state の Cookie が HttpOnly でない')
})

await check('ログアウトは未ログインでも 204', async () => {
  const response = await fetch(`${base}/api/auth/logout`, { method: 'POST' })
  assert(response.status === 204, `status=${response.status}`)
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
