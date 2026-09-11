import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeIssue, MEMBERS, PROJECTS, STATUSES } from '../shared/test-fixtures'
import type { ApiEnvelope } from '../shared/types'
import App from './app'
import { loadFilterQuery, saveFilterQuery } from './filter-store'
import { installBootstrap, installScriptRun, removeBootstrap } from './test-utils'
import type { ScriptRunCall, ScriptRunResponder, ScriptRunStub } from './test-utils'

const VIEWER = { id: 42, userId: null, name: '山田太郎', space: 'example.backlog.jp' }

const WEB_APP_URL = 'https://script.google.com/macros/s/deployment-id/exec'

/** プロジェクトの初期選択は空なので、条件付きで開かれた状態を作るためのクエリ。 */
const SELECTED_QUERY = 'projects=100,200'

let stub: ScriptRunStub | null = null

function ok(data: unknown) {
  return { ok: true as const, data }
}

function failure(status: number, error: string) {
  return { ok: false as const, status, error, detail: null }
}

/** ログイン済みで課題が 2 件返る、標準的な応答。 */
function defaultResponder(loggedIn: boolean): ScriptRunResponder {
  return ({ name }) => {
    switch (name) {
      case 'session': {
        return loggedIn ? ok(VIEWER) : failure(401, 'ログインしていません')
      }
      case 'logout': {
        return ok(null)
      }
      case 'projects': {
        return ok(PROJECTS)
      }
      case 'members': {
        return ok(MEMBERS)
      }
      case 'statuses': {
        return ok(STATUSES)
      }
      case 'holidays': {
        return ok([])
      }
      case 'icons': {
        return ok({})
      }
      case 'issues': {
        return ok({
          issues: [makeIssue({ startDate: null, dueDate: null, id: 9, issueKey: 'PJA-9' }), makeIssue()],
          truncated: false,
          requestCount: 6,
          fetchedAt: new Date().toISOString()
        })
      }
      default: {
        return failure(404, '存在しない API です')
      }
    }
  }
}

function install(responder: ScriptRunResponder) {
  stub = installScriptRun(responder)
  return stub
}

/** 特定の API への呼び出しだけを取り出す。 */
function callsTo(name: string): ScriptRunCall[] {
  return (stub?.calls ?? []).filter((call) => call.name === name)
}

beforeEach(() => {
  installBootstrap({ webAppUrl: WEB_APP_URL })
})

afterEach(() => {
  stub?.restore()
  stub = null
  removeBootstrap()
  vi.restoreAllMocks()
})

describe('起動時', () => {
  it('セッション確認中は読み込み中を出す', () => {
    install(defaultResponder(false))
    render(<App />)
    expect(screen.getByText('読み込み中…')).toBeDefined()
  })

  it('未ログインならログイン画面を出す', async () => {
    install(defaultResponder(false))
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Backlog でログイン' })).toBeDefined()
  })

  it('ログイン済みならガント画面を出す', async () => {
    install(defaultResponder(true))
    render(<App />)
    expect(await screen.findByText('example.backlog.jp / 山田太郎')).toBeDefined()
  })
})

describe('初期選択', () => {
  it('プロジェクトを選ばずに始める', async () => {
    // 参加プロジェクトを勝手に全選択すると、数十プロジェクトに入っている人が
    // 開いた瞬間に重い取得が走る。何を見たいかは利用者に決めてもらう。
    install(defaultResponder(true))
    render(<App />)

    expect(await screen.findByText('プロジェクトを 1 つ以上選択してください。')).toBeDefined()
    // 一覧が届いてもなお未選択のままであることを確かめる。
    expect(await screen.findByRole('button', { name: 'プロジェクト 未選択' })).toBeDefined()
    expect(callsTo('issues')).toHaveLength(0)
  })

  it('プロジェクトを選ぶと担当者は未選択のまま取得する', async () => {
    install(defaultResponder(true))
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'プロジェクト 未選択' }))
    await user.click(screen.getByRole('checkbox', { name: /PJA/u }))

    await waitFor(() => {
      expect(callsTo('issues')).toHaveLength(1)
    })
    expect(callsTo('issues')[0].params.projectIds).toBe('100')
    // 担当者を未選択にしておくと、絞り込まずに全員ぶんを取りに行く。
    expect(callsTo('issues')[0].params.assigneeIds).toBeUndefined()
  })
})

describe('ログイン済みの表示', () => {
  beforeEach(() => {
    // プロジェクトの初期選択は空なので、条件付きの URL で開かれた状態から始める。
    installBootstrap({ webAppUrl: WEB_APP_URL, query: SELECTED_QUERY })
    install(defaultResponder(true))
  })

  it('URL で渡されたプロジェクトの課題を取得する', async () => {
    render(<App />)
    await screen.findByText('example.backlog.jp / 山田太郎')

    await waitFor(() => {
      expect(callsTo('issues')).toHaveLength(1)
    })
    expect(callsTo('issues')[0].params.projectIds).toBe('100,200')
  })

  it('取得した課題をガントに描く', async () => {
    render(<App />)
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="gantt-bar"]').length).toBeGreaterThan(0)
    })
    expect(screen.getAllByText('PJA-1').length).toBeGreaterThan(0)
  })

  it('サマリーに件数を出す', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText(/取得 2 件/u)).toBeDefined()
    })
  })

  it('ズームを変えても再取得しない', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => {
      expect(callsTo('issues')).toHaveLength(1)
    })

    // 既定のズームは「日」なので、「日」を押しても値は変わらず何も検証できない。
    // 実際に値が変わる「週」へ切り替える。
    await user.click(screen.getByRole('button', { name: '週' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '週' }).getAttribute('aria-pressed')).toBe('true')
    })
    expect(callsTo('issues')).toHaveLength(1)
  })

  it('再読込ボタンでキャッシュを無視して取り直す', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => {
      expect(callsTo('issues')).toHaveLength(1)
    })

    await user.click(screen.getByRole('button', { name: '再読込' }))
    await waitFor(() => {
      expect(callsTo('issues')).toHaveLength(2)
    })
    expect(callsTo('issues')[1].params.refresh).toBe('1')
  })

  it('ログアウトするとログイン画面に戻る', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('example.backlog.jp / 山田太郎')

    await user.click(screen.getByRole('button', { name: 'ログアウト' }))
    expect(await screen.findByRole('button', { name: 'Backlog でログイン' })).toBeDefined()
    expect(callsTo('logout')).toHaveLength(1)
  })
})

describe('共有 URL', () => {
  it('ウェブアプリの URL に表示条件を付けてコピーする', async () => {
    // 画面はサンドボックス iframe の中にあるため、location.href をコピーしても
    // 他の人が開ける URL にはならない。
    installBootstrap({ webAppUrl: WEB_APP_URL, query: SELECTED_QUERY })
    install(defaultResponder(true))

    // userEvent はクリップボードの代替実装を用意する。書かれた値はここから読める。
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('example.backlog.jp / 山田太郎')
    await waitFor(() => {
      expect(callsTo('issues')).toHaveLength(1)
    })

    await user.click(screen.getByRole('button', { name: 'URL をコピー' }))
    await screen.findByText('コピーしました')

    const copied = new URL(await navigator.clipboard.readText())
    expect(`${copied.origin}${copied.pathname}`).toBe(WEB_APP_URL)
    expect(copied.searchParams.get('projects')).toBe('100,200')
  })
})

describe('エラーの扱い', () => {
  it('課題取得に失敗したらメッセージを出す', async () => {
    installBootstrap({ webAppUrl: WEB_APP_URL, query: SELECTED_QUERY })
    install((call) =>
      call.name === 'issues' ? failure(429, 'Backlog のレート制限に達しました') : defaultResponder(true)(call)
    )

    render(<App />)
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('レート制限')
  })

  it('途中で 401 になったらログイン画面に戻す', async () => {
    install((call) =>
      call.name === 'projects' ? failure(401, 'セッションの有効期限が切れています') : defaultResponder(true)(call)
    )

    render(<App />)
    expect(await screen.findByRole('button', { name: 'Backlog でログイン' })).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('セッションの有効期限')
  })

  it('コールバックが返した理由コードを説明に変えて表示する', async () => {
    installBootstrap({ webAppUrl: WEB_APP_URL, authError: 'state_expired' })
    install(defaultResponder(false))

    render(<App />)
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('認可の有効期限が切れました')
  })

  it('未知の理由コードでもコードを添えて表示する', async () => {
    installBootstrap({ webAppUrl: WEB_APP_URL, authError: 'weird_thing' })
    install(defaultResponder(false))

    render(<App />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('weird_thing')
  })

  it('OAuth 未設定のままログインしようとしたら理由を出す', async () => {
    installBootstrap({ webAppUrl: WEB_APP_URL, configured: false })
    install(defaultResponder(false))

    const user = userEvent.setup()
    render(<App />)
    await user.type(await screen.findByLabelText('スペースドメイン'), 'example.backlog.jp')
    await user.click(screen.getByRole('button', { name: 'Backlog でログイン' }))

    expect(screen.getByRole('alert').textContent).toContain('OAuth 設定が未完了')
  })
})

describe('読み込み中の表示', () => {
  it('取得が終わるまでチャートの上にインジケーターを出す', async () => {
    // 条件を変えた直後に何も起きていないように見えるのが元の不満なので、
    // 「取得中はチャートの上に出続ける」ことを確かめる。
    const pending: ((envelope: ApiEnvelope) => void)[] = []
    installBootstrap({ webAppUrl: WEB_APP_URL, query: SELECTED_QUERY })
    install((call) => {
      if (call.name !== 'issues' || call.params.refresh !== '1') {
        return defaultResponder(true)(call)
      }
      return new Promise<ApiEnvelope>((resolve) => {
        pending.push(resolve)
      })
    })

    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => {
      expect(document.querySelector('[data-testid="gantt-scroller"]')).not.toBeNull()
    })

    await user.click(screen.getByRole('button', { name: '再読込' }))
    expect(await screen.findByText('読み込み中…')).toBeDefined()
    // 覆いの裏でスクロールバーだけが動かせそうに見えないよう、止めておく。
    expect(document.querySelector('[data-testid="gantt-scroller"]')?.getAttribute('data-loading')).toBe('true')

    pending[0](ok({ issues: [makeIssue()], truncated: false, requestCount: 1, fetchedAt: new Date().toISOString() }))
    await waitFor(() => {
      expect(screen.queryByText('読み込み中…')).toBeNull()
    })
    expect(document.querySelector('[data-testid="gantt-scroller"]')?.getAttribute('data-loading')).toBe('false')
  })
})

describe('表示条件の保存と復元', () => {
  it('保存済みの条件で起動する', async () => {
    await saveFilterQuery(VIEWER.space, 'projects=200&from=2026-09-01&to=2026-09-30&zoom=week')
    install(defaultResponder(true))

    render(<App />)
    await waitFor(() => {
      expect(callsTo('issues')).toHaveLength(1)
    })
    expect(callsTo('issues')[0].params.projectIds).toBe('200')
    expect(screen.getByRole('button', { name: '週' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('別スペースで保存した条件は使わない', async () => {
    // プロジェクト ID はスペースごとの採番なので、流用すると存在しない ID を問い合わせる。
    await saveFilterQuery('other.backlog.jp', 'projects=200&from=2026-09-01&to=2026-09-30')
    install(defaultResponder(true))

    render(<App />)
    expect(await screen.findByText('プロジェクトを 1 つ以上選択してください。')).toBeDefined()
    expect(callsTo('issues')).toHaveLength(0)
  })

  it('共有された URL のほうを優先する', async () => {
    await saveFilterQuery(VIEWER.space, 'projects=200&from=2026-09-01&to=2026-09-30')
    installBootstrap({ webAppUrl: WEB_APP_URL, query: 'projects=100' })
    install(defaultResponder(true))

    render(<App />)
    await waitFor(() => {
      expect(callsTo('issues')).toHaveLength(1)
    })
    expect(callsTo('issues')[0].params.projectIds).toBe('100')
  })

  it('変更した条件を保存する', async () => {
    installBootstrap({ webAppUrl: WEB_APP_URL, query: SELECTED_QUERY })
    install(defaultResponder(true))

    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => {
      expect(callsTo('issues')).toHaveLength(1)
    })

    await user.click(screen.getByRole('button', { name: '月' }))
    await waitFor(async () => {
      expect(await loadFilterQuery(VIEWER.space)).toContain('zoom=month')
    })
  })
})

describe('初期表示条件の復元', () => {
  it('サーバーから渡されたクエリを初期状態に反映する', async () => {
    // Apps Script の Web アプリでは、利用者が開いた URL は doGet だけが知っている。
    installBootstrap({ webAppUrl: WEB_APP_URL, query: 'projects=200&group=project&zoom=day' })
    install(defaultResponder(true))

    render(<App />)
    await waitFor(() => {
      expect(callsTo('issues')).toHaveLength(1)
    })
    expect(callsTo('issues')[0].params.projectIds).toBe('200')

    expect((screen.getByLabelText('グルーピング') as unknown as HTMLSelectElement).value).toBe('project')
    expect(screen.getByRole('button', { name: '日' }).getAttribute('aria-pressed')).toBe('true')
  })
})
