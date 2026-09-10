/**
 * OAuth 2.0 のログイン・コールバック・ログアウトを担当するルート。
 */

import { Hono } from 'hono'

import type { ApiErrorBody, Viewer } from '../../shared/types'
import { BacklogApiError, BacklogClient } from '../backlog/client'
import { fetchViewer } from '../backlog/masters'
import { normalizeSpace } from '../backlog/space'
import { isSecureRequest, resolveOAuthConfig } from './config'
import type { AppBindings } from './config'
import { buildAuthorizeUrl, exchangeCode, OAuthError } from './oauth'
import {
  buildClearCookie,
  buildCookie,
  deleteSession,
  getSession,
  putSession,
  putState,
  randomId,
  readCookie,
  sanitizeReturnTo,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  STATE_COOKIE,
  STATE_TTL_SECONDS,
  takeState
} from './session'

export const auth = new Hono<{ Bindings: AppBindings }>()

/**
 * ログイン開始。スペースを指定して Backlog の認可画面へ送る。
 *
 * リダイレクト先はユーザー入力（スペース）から組み立てるため、
 * 必ず許可ドメインの検証を通してから使う。
 */
auth.get('/login', async (c) => {
  const space = normalizeSpace(c.req.query('space'))
  if (!space) {
    return c.json<ApiErrorBody>(
      {
        error: 'Backlog のスペースドメインが正しくありません',
        detail: 'example.backlog.jp / example.backlog.com / example.backlogtool.com の形式で指定してください'
      },
      400
    )
  }

  const config = resolveOAuthConfig(c.env, c.req.url)
  if (!config) {
    return c.json<ApiErrorBody>(
      {
        error: 'OAuth の設定が未完了です',
        detail: 'BACKLOG_CLIENT_ID と BACKLOG_CLIENT_SECRET を設定してください'
      },
      500
    )
  }

  const state = randomId()
  await putState(c.env.SESSIONS, state, {
    space,
    returnTo: sanitizeReturnTo(c.req.query('returnTo'))
  })

  const secure = isSecureRequest(c.req.url)
  c.header('Set-Cookie', buildCookie(STATE_COOKIE, state, { maxAge: STATE_TTL_SECONDS, secure }))
  c.header('Cache-Control', 'no-store')
  return c.redirect(buildAuthorizeUrl(space, config, state), 302)
})

/** 認可コードを受け取ってセッションを作る。 */
auth.get('/callback', async (c) => {
  const secure = isSecureRequest(c.req.url)
  c.header('Cache-Control', 'no-store')

  const authError = c.req.query('error')
  if (authError) {
    return c.redirect(`/?auth_error=${encodeURIComponent(authError)}`, 302)
  }

  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state) {
    return c.redirect('/?auth_error=missing_code', 302)
  }

  // KV の state と Cookie の state を突き合わせ、CSRF とセッション固定を防ぐ。
  const cookieState = readCookie(c.req.header('Cookie'), STATE_COOKIE)
  if (cookieState !== state) {
    return c.redirect('/?auth_error=state_mismatch', 302)
  }

  const stateRecord = await takeState(c.env.SESSIONS, state)
  if (!stateRecord) {
    return c.redirect('/?auth_error=state_expired', 302)
  }

  const config = resolveOAuthConfig(c.env, c.req.url)
  if (!config) {
    return c.redirect('/?auth_error=not_configured', 302)
  }

  try {
    const tokens = await exchangeCode(stateRecord.space, config, code, Date.now())
    const client = new BacklogClient({ space: stateRecord.space, accessToken: tokens.accessToken })
    const viewer = await fetchViewer(client)

    const sessionId = randomId()
    await putSession(c.env.SESSIONS, sessionId, {
      space: stateRecord.space,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      userId: viewer.id,
      userName: viewer.name
    })

    c.header('Set-Cookie', buildClearCookie(STATE_COOKIE, secure), { append: true })
    c.header('Set-Cookie', buildCookie(SESSION_COOKIE, sessionId, { maxAge: SESSION_TTL_SECONDS, secure }), {
      append: true
    })
    return c.redirect(stateRecord.returnTo, 302)
  } catch (error: unknown) {
    if (error instanceof OAuthError || error instanceof BacklogApiError) {
      return c.redirect('/?auth_error=token_exchange_failed', 302)
    }
    throw error
  }
})

/** 現在のセッション情報。未ログインなら 401。 */
auth.get('/session', async (c) => {
  c.header('Cache-Control', 'no-store')
  const sessionId = readCookie(c.req.header('Cookie'), SESSION_COOKIE)
  if (!sessionId) {
    return c.json<ApiErrorBody>({ error: 'ログインしていません' }, 401)
  }

  const session = await getSession(c.env.SESSIONS, sessionId)
  if (!session) {
    return c.json<ApiErrorBody>({ error: 'セッションの有効期限が切れています' }, 401)
  }

  return c.json<Viewer>({
    id: session.userId,
    userId: null,
    name: session.userName,
    space: session.space
  })
})

/** ログアウト。セッションを破棄して Cookie を消す。 */
auth.post('/logout', async (c) => {
  c.header('Cache-Control', 'no-store')
  const sessionId = readCookie(c.req.header('Cookie'), SESSION_COOKIE)
  if (sessionId) {
    await deleteSession(c.env.SESSIONS, sessionId)
  }
  c.header('Set-Cookie', buildClearCookie(SESSION_COOKIE, isSecureRequest(c.req.url)))
  return c.body(null, 204)
})
