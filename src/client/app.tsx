import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { todayKey } from '../shared/date'
import { fetchKey, filterToParams, parseFilter } from '../shared/filter'
import { summarize } from '../shared/gantt'
import type { GanttIssue, MemberSummary, ProjectSummary, StatusGroup, Viewer, ViewFilter } from '../shared/types'
import { ApiError, type Connection, connect, getIssues, getMembers, getProjects, getStatuses } from './api'
import { ConnectPanel } from './components/ConnectPanel'
import { FilterBar } from './components/FilterBar'
import { GanttChart } from './components/GanttChart'
import { SummaryBar } from './components/SummaryBar'
import { clearConnection, loadConnection, saveConnection } from './storage'

/** 初回表示時に自動選択するプロジェクト数の上限。多すぎると初回取得が重くなるため。 */
const AUTO_SELECT_LIMIT = 5

/** キーワード入力を取得リクエストへ反映するまでの待ち時間。 */
const KEYWORD_DEBOUNCE_MS = 400

function toMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail ? `${error.message}（${error.detail}）` : error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return '不明なエラーが発生しました'
}

/** AbortError は利用者に見せる必要がないため無視する。 */
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export default function App() {
  const [connection, setConnection] = useState<Connection | null>(() => loadConnection())
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [showConnectPanel, setShowConnectPanel] = useState(false)

  const [filter, setFilter] = useState<ViewFilter>(() =>
    parseFilter(new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search))
  )
  const [debouncedKeyword, setDebouncedKeyword] = useState(filter.keyword)

  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [members, setMembers] = useState<MemberSummary[]>([])
  const [statuses, setStatuses] = useState<StatusGroup[]>([])

  const [issues, setIssues] = useState<GanttIssue[]>([])
  const [truncated, setTruncated] = useState(false)
  const [requestCount, setRequestCount] = useState(0)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  /** 再読込ボタンでキャッシュを無視するためのカウンタ。 */
  const [reloadToken, setReloadToken] = useState(0)
  const bypassCacheRef = useRef(false)
  const autoSelectedRef = useRef(false)

  const today = useMemo(() => todayKey(), [])

  const patchFilter = useCallback((patch: Partial<ViewFilter>) => {
    setFilter((prev) => {
      const next = { ...prev, ...patch }
      // 期間が逆転しないように補正する。
      if (next.to < next.from) {
        if (patch.from !== undefined) {
          next.to = next.from
        } else {
          next.from = next.to
        }
      }
      return next
    })
  }, [])

  // --- 接続 ---

  const handleConnect = useCallback((candidate: Connection) => {
    setConnecting(true)
    setConnectError(null)
    connect(candidate)
      .then((result) => {
        saveConnection(candidate)
        setConnection(candidate)
        setViewer(result)
        setShowConnectPanel(false)
      })
      .catch((error: unknown) => {
        setConnectError(toMessage(error))
      })
      .finally(() => setConnecting(false))
  }, [])

  const handleDisconnect = useCallback(() => {
    clearConnection()
    setConnection(null)
    setViewer(null)
    setProjects([])
    setMembers([])
    setStatuses([])
    setIssues([])
    setFetchedAt(null)
    setShowConnectPanel(false)
  }, [])

  // 保存済みの接続情報を起動時に検証する。
  useEffect(() => {
    if (!connection || viewer) {
      return
    }
    const controller = new AbortController()
    setConnecting(true)
    connect(connection, controller.signal)
      .then((result) => setViewer(result))
      .catch((error: unknown) => {
        if (isAbort(error)) {
          return
        }
        setConnectError(toMessage(error))
        setShowConnectPanel(true)
      })
      .finally(() => setConnecting(false))
    return () => controller.abort()
  }, [connection, viewer])

  // --- マスタ取得 ---

  useEffect(() => {
    if (!connection || !viewer) {
      return
    }
    const controller = new AbortController()
    getProjects(connection, false, controller.signal)
      .then(setProjects)
      .catch((error: unknown) => {
        if (!isAbort(error)) {
          setLoadError(toMessage(error))
        }
      })
    return () => controller.abort()
  }, [connection, viewer])

  // プロジェクト未選択のまま開かれた場合は、先頭のいくつかを自動選択する。
  useEffect(() => {
    if (autoSelectedRef.current || projects.length === 0 || filter.projectIds.length > 0) {
      return
    }
    autoSelectedRef.current = true
    patchFilter({ projectIds: projects.slice(0, AUTO_SELECT_LIMIT).map((project) => project.id) })
  }, [projects, filter.projectIds.length, patchFilter])

  const projectIdsKey = filter.projectIds.join(',')

  useEffect(() => {
    if (!connection || !viewer || filter.projectIds.length === 0) {
      setMembers([])
      setStatuses([])
      return
    }
    const controller = new AbortController()
    const ids = projectIdsKey.split(',').map(Number)
    Promise.all([
      getMembers(connection, ids, false, controller.signal),
      getStatuses(connection, ids, false, controller.signal)
    ])
      .then(([memberList, statusList]) => {
        setMembers(memberList)
        setStatuses(statusList)
      })
      .catch((error: unknown) => {
        if (!isAbort(error)) {
          setLoadError(toMessage(error))
        }
      })
    return () => controller.abort()
    // projectIdsKey で依存を表現しているため filter.projectIds 自体は依存に含めない。
  }, [connection, viewer, projectIdsKey, filter.projectIds.length])

  // --- キーワードのデバウンス ---

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(filter.keyword), KEYWORD_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [filter.keyword])

  // --- 課題取得 ---

  const requestFilter = useMemo<ViewFilter>(
    () => ({ ...filter, keyword: debouncedKeyword }),
    [filter, debouncedKeyword]
  )
  const requestKey = fetchKey(requestFilter)

  /**
   * 取得条件は requestKey に集約している。requestFilter そのものを依存に入れると、
   * グルーピングやズームの変更（サーバーへの再取得が不要な操作）でも再取得が走るため、
   * 値の受け渡しには ref を使う。
   */
  const requestFilterRef = useRef(requestFilter)
  requestFilterRef.current = requestFilter

  // biome-ignore lint/correctness/useExhaustiveDependencies: requestKey と reloadToken は取得条件の変化と再読込操作を表すトリガーとして意図的に依存へ入れている
  useEffect(() => {
    const target = requestFilterRef.current
    if (!connection || !viewer || target.projectIds.length === 0) {
      setIssues([])
      setFetchedAt(null)
      return
    }
    const controller = new AbortController()
    const bypass = bypassCacheRef.current
    bypassCacheRef.current = false

    setLoading(true)
    setLoadError(null)
    getIssues(connection, target, bypass, controller.signal)
      .then((response) => {
        setIssues(response.issues)
        setTruncated(response.truncated)
        setRequestCount(response.requestCount)
        setFetchedAt(response.fetchedAt)
      })
      .catch((error: unknown) => {
        if (isAbort(error)) {
          return
        }
        setLoadError(toMessage(error))
        setIssues([])
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [connection, viewer, requestKey, reloadToken])

  // --- URL 同期 ---

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const params = filterToParams(filter)
    const query = params.toString()
    const next = `${window.location.pathname}${query ? `?${query}` : ''}`
    window.history.replaceState(null, '', next)
  }, [filter])

  const handleReload = useCallback(() => {
    bypassCacheRef.current = true
    setReloadToken((value) => value + 1)
  }, [])

  const [copied, setCopied] = useState(false)
  const handleCopyUrl = useCallback(() => {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => setLoadError('URL のコピーに失敗しました'))
  }, [])

  const projectNames = useMemo(() => {
    const map: Record<number, string> = {}
    for (const project of projects) {
      map[project.id] = `${project.projectKey} ${project.name}`
    }
    return map
  }, [projects])

  const summary = useMemo(
    () => summarize(issues, filter.from, filter.to, today),
    [issues, filter.from, filter.to, today]
  )

  if (!connection || showConnectPanel) {
    return (
      <ConnectPanel
        initial={connection}
        onSubmit={handleConnect}
        onCancel={connection && viewer ? () => setShowConnectPanel(false) : undefined}
        connecting={connecting}
        error={connectError}
      />
    )
  }

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <span className="app__logo" aria-hidden="true">
            ▤
          </span>
          <div>
            <h1 className="app__title">CrossGantt for Backlog</h1>
            <p className="app__space">
              {viewer ? `${viewer.space} / ${viewer.name}` : connecting ? '接続中…' : connection.space}
            </p>
          </div>
        </div>
        <div className="app__actions">
          <button type="button" className="button" onClick={handleReload} disabled={loading}>
            再読込
          </button>
          <button type="button" className="button" onClick={handleCopyUrl}>
            {copied ? 'コピーしました' : 'URL をコピー'}
          </button>
          <button type="button" className="button" onClick={() => setShowConnectPanel(true)}>
            接続設定
          </button>
          <button type="button" className="button" onClick={handleDisconnect}>
            切断
          </button>
        </div>
      </header>

      <FilterBar
        filter={filter}
        onChange={patchFilter}
        projects={projects}
        members={members}
        statuses={statuses}
        loading={loading}
      />

      <SummaryBar
        summary={summary}
        truncated={truncated}
        requestCount={requestCount}
        fetchedAt={fetchedAt}
        loading={loading}
      />

      {loadError ? (
        <p className="app__error" role="alert">
          {loadError}
        </p>
      ) : null}

      {filter.projectIds.length === 0 ? (
        <div className="gantt-empty">
          <p>プロジェクトを 1 つ以上選択してください。</p>
        </div>
      ) : (
        <GanttChart issues={issues} filter={filter} today={today} projectNames={projectNames} />
      )}
    </div>
  )
}
