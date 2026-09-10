import { Hono } from 'hono'
import { renderToReadableStream } from 'react-dom/server'
import { ReactRefresh, Script, ViteClient } from 'vite-ssr-components/react'

import type { AppBindings } from './server/auth/config'
import { auth } from './server/auth/routes'
import { api } from './server/routes'

const app = new Hono<{ Bindings: AppBindings }>()

// 認証まわりはセッションを持たない状態でも通す必要があるため、
// セッション必須のプロキシ API より先にマウントする。
app.route('/api/auth', auth)
app.route('/api', api)

// 想定外の例外はここで受け止める。`api` 側の onError はそのサブアプリにしか効かず、
// 認可コールバックや SSR で投げられた例外は Hono 既定のプレーンテキスト 500 になる。
// クライアントの `request()` は本文を JSON として読むため、そのままでは
// 「リクエストに失敗しました (500)」としか分からない。
app.onError((err, c) => {
  console.error('unhandled error', err)
  return c.json({ error: '予期しないエラーが発生しました' }, 500)
})

// 未定義の API パスは HTML ではなく 404 の JSON を返す。SPA のフォールバックに
// 落ちると、クライアントは 200 の HTML を JSON として解釈しようとして失敗する。
app.all('/api/*', (c) => c.json({ error: '存在しない API です' }, 404))

app.get('*', async (c) => {
  c.header('Content-Type', 'text/html; charset=utf-8')
  return c.body(
    await renderToReadableStream(
      <html lang="ja">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>CrossGantt for Backlog</title>
          <meta
            name="description"
            content="Backlog の複数プロジェクト・複数担当者の課題を 1 枚のガントチャートで横断表示します。"
          />
          <ViteClient />
          <ReactRefresh />
          {/* Script はビルド後の manifest を見て、対応する CSS の link も出力する。 */}
          <Script src="/src/client/index.tsx" />
        </head>
        <body>
          <div id="root" />
        </body>
      </html>
    )
  )
})

export default app
