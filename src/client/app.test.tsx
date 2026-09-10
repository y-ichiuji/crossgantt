import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeIssue, MEMBERS, PROJECTS, STATUSES } from '../shared/test-fixtures'
import App from './app'

const originalFetch = globalThis.fetch

type Handler = (url: URL, init: RequestInit | undefined) => Response

let requestedUrls: string[]

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const VIEWER = { id: 42, userId: null, name: '山田太郎', space: 'example.backlog.jp' }

/** ログイン済みで課題が 1 件返る、標準的な応答。 */
function defaultHandler(loggedIn: boolean): Handler {
  return (url) => {
    if (url.pathname === '/api/auth/session') {
      return loggedIn ? json(VIEWER) : json({ error: 'ログインしていません' }, 401)
    }
    if (url.pathname === '/api/auth/logout') {
      return new Response(null, { status: 204 })
    }
    if (url.pathname === '/api/projects') {
      return json(PROJECTS)
    }
    if (url.pathname === '/api/members') {
      return json(MEMBERS)
    }
    if (url.pathname === '/api/statuses') {
      return json(STATUSES)
    }
    if (url.pathname === '/api/issues') {
      return json({
        issues: [makeIssue({ startDate: null, dueDate: null, id: 9, issueKey: 'PJA-9' }), makeIssue()],
        truncated: false,
        requestCount: 6,
        fetchedAt: new Date().toISOString()
      })
    }
    return json({ error: 'not found' }, 404)
  }
}

function stubFetch(handler: Handler) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    requestedUrls.push(raw)
    return handler(new URL(raw, 'http://localhost'), init)
  }) as typeof fetch
}

beforeEach(() => {
  requestedUrls = []
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('起動時', () => {
  it('セッション確認中は読み込み中を出す', () => {
    stubFetch(defaultHandler(false))
    render(<App />)
    expect(screen.getByText('読み込み中…')).toBeDefined()
  })

  it('未ログインならログイン画面を出す', async () => {
    stubFetch(defaultHandler(false))
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Backlog でログイン' })).toBeDefined()
  })

  it('ログイン済みならガント画面を出す', async () => {
    stubFetch(defaultHandler(true))
    render(<App />)
    expect(await screen.findByText('example.backlog.jp / 山田太郎')).toBeDefined()
  })
})

describe('ログイン済みの表示', () => {
  beforeEach(() => {
    stubFetch(defaultHandler(true))
  })

  it('プロジェクトを自動選択して課題を取得する', async () => {
    render(<App />)
    await screen.findByText('example.backlog.jp / 山田太郎')

    await waitFor(() => {
      expect(requestedUrls.some((url) => url.startsWith('/api/issues'))).toBe(true)
    })
    const issuesUrl = new URL(requestedUrls.find((url) => url.startsWith('/api/issues')) as string, 'http://localhost')
    expect(issuesUrl.searchParams.get('projectIds')).toBe('100,200')
  })

  it('取得した課題をガントに描く', async () => {
    render(<App />)
    await waitFor(() => {
      expect(document.querySelectorAll('.gantt__bar').length).toBeGreaterThan(0)
    })
    expect(screen.getAllByText('PJA-1').length).toBeGreaterThan(0)
  })

  it('サマリーに件数を出す', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText(/取得 2 件/)).toBeDefined()
    })
  })

  it('表示条件を URL に反映する', async () => {
    render(<App />)
    await waitFor(() => {
      expect(window.location.search).toContain('projects=100%2C200')
    })
  })

  it('ズームを変えても再取得しない', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => {
      expect(requestedUrls.filter((url) => url.startsWith('/api/issues'))).toHaveLength(1)
    })

    await user.click(screen.getByRole('button', { name: '日' }))
    await waitFor(() => {
      expect(document.querySelector('.gantt__weekend')).not.toBeNull()
    })
    expect(requestedUrls.filter((url) => url.startsWith('/api/issues'))).toHaveLength(1)
  })

  it('再読込ボタンでキャッシュを無視して取り直す', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => {
      expect(requestedUrls.filter((url) => url.startsWith('/api/issues'))).toHaveLength(1)
    })

    await user.click(screen.getByRole('button', { name: '再読込' }))
    await waitFor(() => {
      const issueRequests = requestedUrls.filter((url) => url.startsWith('/api/issues'))
      expect(issueRequests).toHaveLength(2)
      expect(issueRequests[1]).toContain('refresh=1')
    })
  })

  it('ログアウトするとログイン画面に戻る', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('example.backlog.jp / 山田太郎')

    await user.click(screen.getByRole('button', { name: 'ログアウト' }))
    expect(await screen.findByRole('button', { name: 'Backlog でログイン' })).toBeDefined()
    expect(requestedUrls).toContain('/api/auth/logout')
  })
})

describe('エラーの扱い', () => {
  it('課題取得に失敗したらメッセージを出す', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/auth/session') {
        return json(VIEWER)
      }
      if (url.pathname === '/api/issues') {
        return json({ error: 'Backlog のレート制限に達しました' }, 429)
      }
      if (url.pathname === '/api/projects') {
        return json(PROJECTS)
      }
      return json([])
    })

    render(<App />)
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('レート制限')
  })

  it('途中で 401 になったらログイン画面に戻す', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/auth/session') {
        return json(VIEWER)
      }
      if (url.pathname === '/api/projects') {
        return json({ error: 'セッションの有効期限が切れています' }, 401)
      }
      return json([])
    })

    render(<App />)
    expect(await screen.findByRole('button', { name: 'Backlog でログイン' })).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('セッションの有効期限')
  })

  it('コールバックの auth_error を読み取って表示し URL から消す', async () => {
    window.history.replaceState(null, '', '/?auth_error=state_expired')
    stubFetch(defaultHandler(false))

    render(<App />)
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('認可の有効期限が切れました')
    expect(window.location.search).not.toContain('auth_error')
  })

  it('未知の auth_error でもコードを添えて表示する', async () => {
    window.history.replaceState(null, '', '/?auth_error=weird_thing')
    stubFetch(defaultHandler(false))

    render(<App />)
    expect((await screen.findByRole('alert')).textContent).toContain('weird_thing')
  })
})

describe('URL からの復元', () => {
  it('クエリの表示条件を初期状態に反映する', async () => {
    window.history.replaceState(null, '', '/?projects=200&group=project&zoom=day')
    stubFetch(defaultHandler(true))

    render(<App />)
    await waitFor(() => {
      expect(requestedUrls.some((url) => url.startsWith('/api/issues'))).toBe(true)
    })
    const issuesUrl = new URL(requestedUrls.find((url) => url.startsWith('/api/issues')) as string, 'http://localhost')
    expect(issuesUrl.searchParams.get('projectIds')).toBe('200')

    expect((screen.getByLabelText('グルーピング') as unknown as HTMLSelectElement).value).toBe('project')
    expect(screen.getByRole('button', { name: '日' }).getAttribute('aria-pressed')).toBe('true')
  })
})
