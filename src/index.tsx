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
