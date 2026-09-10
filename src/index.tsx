import { Hono } from 'hono'
import { renderToReadableStream } from 'react-dom/server'
import { Link, ReactRefresh, Script, ViteClient } from 'vite-ssr-components/react'
import { api } from './server/routes'

const app = new Hono<{ Bindings: CloudflareBindings }>()

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
          <Script src="/src/client/index.tsx" />
          <Link href="/src/style.css" rel="stylesheet" />
        </head>
        <body>
          <div id="root" />
        </body>
      </html>
    )
  )
})

export default app
