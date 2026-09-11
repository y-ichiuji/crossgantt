/**
 * Apps Script のエントリポイント。
 *
 * Web アプリは URL を 1 本しか持たないため、`doGet` が画面の配信と
 * OAuth のコールバックの両方を受ける。画面からの API 呼び出しは
 * `google.script.run.apiCall(...)` を通ってここへ来る。
 *
 * ビルド時にこのモジュールは 1 つのグローバルへまとめられ、Apps Script が
 * 見つけられるトップレベル関数（doGet / apiCall / include）が横に並ぶ。
 */

// 足りない組み込みを最初に補う。
// oxlint-disable-next-line import/no-unassigned-import
import './polyfill'
import type { Bootstrap } from '../../shared/types'
import { handleApiCall } from '../api'
import type { ApiParams } from '../api'
import { handleAuthCallback, isAuthCallback } from '../auth/callback'
import { issueNonce } from '../auth/session'
import { renderApp } from './html'
import { createApiContext, randomToken, resolveSettings } from './runtime'

export { include } from './html'

/** 認可フローが使うパラメータ。初期表示条件としては引き継がない。 */
const RESERVED_PARAMS = new Set(['code', 'state', 'error'])

/** 受け取ったクエリパラメータを、そのままクライアントへ渡せる形に戻す。 */
function toQueryString(params: Record<string, string | undefined>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || RESERVED_PARAMS.has(key)) {
      continue
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  }
  return parts.join('&')
}

/** 画面の配信と OAuth コールバックの受け取り。 */
export function doGet(event?: GoogleAppsScript.Events.DoGet): GoogleAppsScript.HTML.HtmlOutput {
  const params: Record<string, string | undefined> = event?.parameter ?? {}
  const settings = resolveSettings()
  const context = createApiContext(settings)

  let query = toQueryString(params)
  let authError: string | null = null
  if (isAuthCallback(params)) {
    const result = handleAuthCallback(context, params)
    query = result.query
    authError = result.errorCode
  }

  // 認可画面への遷移はクライアント側でリンクとして組み立てる。
  // その state に載せる nonce を、画面を返すたびに払い出しておく。
  const nonce = randomToken()
  issueNonce(context.store, nonce, context.now())

  const bootstrap: Bootstrap = {
    webAppUrl: settings.webAppUrl,
    query,
    configured: settings.oauth !== null,
    clientId: settings.oauth?.clientId ?? '',
    redirectUri: settings.oauth?.redirectUri ?? '',
    nonce,
    authError
  }
  return renderApp(bootstrap)
}

/**
 * 画面からの API 呼び出し。
 *
 * `google.script.run` は受け渡しできる値の型が限られるため、入出力は
 * どちらも JSON 文字列に固定する。
 */
export function apiCall(name: string, paramsJson: string): string {
  const settings = resolveSettings()
  const context = createApiContext(settings)

  let params: ApiParams = {}
  try {
    const parsed: unknown = JSON.parse(paramsJson)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      params = parsed as ApiParams
    }
  } catch {
    // 壊れた入力は「パラメータなし」として扱う。各ハンドラが検証する。
  }

  return JSON.stringify(handleApiCall(context, name, params))
}
