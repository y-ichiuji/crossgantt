/**
 * Backlog の認可コールバックの処理。
 *
 * Apps Script の Web アプリは URL を 1 本しか持たないため、コールバックも
 * アプリ本体と同じ `doGet` で受ける。`code` が付いていればここへ回し、
 * セッションを作ってからアプリの HTML を返す。
 */

import { decodeState } from '../../shared/oauth'
import type { ApiContext } from '../api'
import { BacklogApiError, BacklogClient } from '../backlog/client'
import { fetchViewer } from '../backlog/masters'
import { exchangeCode, OAuthError } from './oauth'
import { consumeNonce, readSession, writeSession } from './session'

export type CallbackResult = {
  /** 認可前に見ていた表示条件のクエリ文字列（`?` は含まない）。 */
  query: string
  /** 失敗した場合の理由コード。成功なら null。 */
  errorCode: string | null
}

/** コールバックかどうか。 */
export function isAuthCallback(params: Record<string, string | undefined>): boolean {
  return Boolean(params.code ?? params.error)
}

/**
 * 認可コードを受け取ってセッションを作る。
 *
 * 成功しても失敗しても画面自体は返すため、ここでは理由コードだけを返し、
 * 表示はクライアントに任せる。
 */
export function handleAuthCallback(ctx: ApiContext, params: Record<string, string | undefined>): CallbackResult {
  const authError = params.error
  if (authError) {
    return { query: '', errorCode: authError }
  }

  const code = params.code
  const state = decodeState(params.state)
  if (!code) {
    return { query: '', errorCode: 'missing_code' }
  }
  // 許可ドメイン以外のスペースや、形の合わない state はここで弾く。
  if (!state) {
    return { query: '', errorCode: 'state_mismatch' }
  }

  const now = ctx.now()
  if (!consumeNonce(ctx.store, state.nonce, now)) {
    // 認可直後の画面をそのまま再読込すると、消費済みの code と nonce で
    // もう一度ここへ来る。すでにログインできているなら失敗扱いにしない。
    if (readSession(ctx.store, now)) {
      return { query: state.query, errorCode: null }
    }
    return { query: state.query, errorCode: 'state_expired' }
  }

  if (!ctx.oauth) {
    return { query: state.query, errorCode: 'not_configured' }
  }

  try {
    const tokens = exchangeCode(state.space, ctx.oauth, code, now, ctx.fetcher)
    const viewer = fetchViewer(
      new BacklogClient({
        space: state.space,
        accessToken: tokens.accessToken,
        fetcher: ctx.fetcher,
        sleep: ctx.sleep,
        now: ctx.now
      })
    )
    writeSession(
      ctx.store,
      {
        space: state.space,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        userId: viewer.id,
        userName: viewer.name
      },
      now
    )
    return { query: state.query, errorCode: null }
  } catch (error: unknown) {
    if (error instanceof OAuthError || error instanceof BacklogApiError) {
      ctx.log('アクセストークンの取得に失敗しました', error)
      return { query: state.query, errorCode: 'token_exchange_failed' }
    }
    throw error
  }
}
