/**
 * クライアント側テスト用の補助。実装からは参照されない。
 *
 * サーバーとのやり取りは `google.script.run` に閉じているため、
 * ここではそれと、`doGet` が埋め込む設定を差し替える手段だけを用意する。
 */

import type { ApiEnvelope, Bootstrap } from '../shared/types'
import { BOOTSTRAP_ELEMENT_ID, resetBootstrap } from './bootstrap'

export type ScriptRunCall = {
  name: string
  params: Record<string, string>
}

/** 1 回の呼び出しに対する応答。Error を返すと失敗ハンドラが呼ばれる。 */
export type ScriptRunResponder = (call: ScriptRunCall) => ApiEnvelope | Error

type Handlers = {
  success?: (value: string) => void
  failure?: (error: Error) => void
}

type ScriptRunner = {
  withSuccessHandler: (handler: (value: string) => void) => ScriptRunner
  withFailureHandler: (handler: (error: Error) => void) => ScriptRunner
  apiCall: (name: string, paramsJson: string) => void
}

export type ScriptRunStub = {
  /** 呼ばれた内容を呼ばれた順に記録する。 */
  calls: ScriptRunCall[]
  restore: () => void
}

/**
 * `google.script.run` を模した実装を `window` へ差し込む。
 *
 * 本物と同じく `withSuccessHandler` などは新しいランナーを返し、応答は
 * 非同期に届く。ハンドラを付け替えたランナーが混ざらないことも確かめられる。
 */
export function installScriptRun(respond: ScriptRunResponder): ScriptRunStub {
  const calls: ScriptRunCall[] = []

  const invoke = (handlers: Handlers, name: string, paramsJson: string): void => {
    const params = JSON.parse(paramsJson) as Record<string, string>
    const call: ScriptRunCall = { name, params }
    calls.push(call)
    queueMicrotask(() => {
      const result = respond(call)
      if (result instanceof Error) {
        handlers.failure?.(result)
        return
      }
      handlers.success?.(JSON.stringify(result))
    })
  }

  const chain = (handlers: Handlers): ScriptRunner => ({
    withSuccessHandler: (handler) => chain({ ...handlers, success: handler }),
    withFailureHandler: (handler) => chain({ ...handlers, failure: handler }),
    apiCall: (name, paramsJson) => invoke(handlers, name, paramsJson)
  })

  const carrier = window as unknown as { google?: unknown }
  const original = carrier.google
  carrier.google = { script: { run: chain({}) } }

  return {
    calls,
    restore: () => {
      carrier.google = original
    }
  }
}

/** `doGet` が埋め込む設定を差し替える。 */
export function installBootstrap(overrides: Partial<Bootstrap> = {}): Bootstrap {
  const bootstrap: Bootstrap = {
    webAppUrl: 'https://script.google.com/macros/s/deployment-id/exec',
    query: '',
    configured: true,
    clientId: 'client-id',
    redirectUri: 'https://script.google.com/macros/s/deployment-id/exec',
    nonce: 'a1b2c3d4e5f60718',
    authError: null,
    ...overrides
  }
  resetBootstrap()
  removeBootstrap()
  // 本番のテンプレートは `<script type="application/json">` を使う。HTML として
  // 解析されるときに実体参照を解かせないためで、ここでは `textContent` へ直接
  // 入れるので解析は起きない。`loadBootstrap` は要素の種類を見ずに
  // `textContent` を読むため、`div` でも検証したい挙動は変わらない。
  const element = document.createElement('div')
  element.id = BOOTSTRAP_ELEMENT_ID
  element.hidden = true
  element.textContent = JSON.stringify(bootstrap)
  document.head.append(element)
  return bootstrap
}

/** 差し込んだ設定を取り除く。 */
export function removeBootstrap(): void {
  resetBootstrap()
  document.getElementById(BOOTSTRAP_ELEMENT_ID)?.remove()
}
