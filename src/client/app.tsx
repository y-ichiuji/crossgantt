import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { todayKey } from '../shared/date'
import { filterToParams, parseFilter } from '../shared/filter'
import { summarize } from '../shared/gantt'
import type {
  GanttIssue,
  IssuesQuery,
  MemberSummary,
  ProjectSummary,
  StatusGroup,
  Viewer,
  ViewFilter
} from '../shared/types'
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

/** 「コピーしました」の表示を戻すまでの時間。 */
const COPIED_FEEDBACK_MS = 1500

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

/** カンマ区切りに畳んだ ID キーを配列へ戻す。 */
function parseIdsKey(key: string): number[] {
  return key === '' ? [] : key.split(',').map(Number)
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
    const run = async () => {
      setConnecting(true)
      setConnectError(null)
      try {
        const result = await connect(candidate)
        saveConnection(candidate)
        setConnection(candidate)
        setViewer(result)
        setShowConnectPanel(false)
      } catch (error: unknown) {
        setConnectError(toMessage(error))
      } finally {
        setConnecting(false)
      }
    }
    void run()
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
    const run = async () => {
      setConnecting(true)
      try {
        setViewer(await connect(connection, controller.signal))
      } catch (error: unknown) {
        if (isAbort(error)) {
          return
        }
        setConnectError(toMessage(error))
        setShowConnectPanel(true)
      } finally {
        setConnecting(false)
      }
    }
    void run()
    return () => controller.abort()
  }, [connection, viewer])

  // --- マスタ取得 ---

  useEffect(() => {
    if (!connection || !viewer) {
      return
    }
    const controller = new AbortController()
    const run = async () => {
      try {
        setProjects(await getProjects(connection, false, controller.signal))
      } catch (error: unknown) {
        if (!isAbort(error)) {
          setLoadError(toMessage(error))
        }
      }
    }
    void run()
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

  // 依存配列をプリミティブだけで表現するため、配列はカンマ区切りのキーに畳む。
  const projectIdsKey = filter.projectIds.join(',')
  const assigneeIdsKey = filter.assigneeIds.join(',')
  const statusNamesKey = filter.statusNames.join(',')

  useEffect(() => {
    if (!connection || !viewer || projectIdsKey === '') {
      setMembers([])
      setStatuses([])
      return
    }
    const controller = new AbortController()
    const ids = parseIdsKey(projectIdsKey)
    const run = async () => {
      try {
        const [memberList, statusList] = await Promise.all([
          getMembers(connection, ids, false, controller.signal),
          getStatuses(connection, ids, false, controller.signal)
        ])
        setMembers(memberList)
        setStatuses(statusList)
      } catch (error: unknown) {
        if (!isAbort(error)) {
          setLoadError(toMessage(error))
        }
      }
    }
    void run()
    return () => controller.abort()
  }, [connection, viewer, projectIdsKey])

  // --- キーワードのデバウンス ---

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(filter.keyword), KEYWORD_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [filter.keyword])

  // --- 課題取得 ---

  /**
   * 取得条件だけを取り出したオブジェクト。
   *
   * グルーピング軸やズームを変えただけで再取得が走らないよう、
   * 依存はプリミティブに畳んだキーだけで表現している。
   */
  const query = useMemo<IssuesQuery>(
    () => ({
      projectIds: parseIdsKey(projectIdsKey),
      assigneeIds: parseIdsKey(assigneeIdsKey),
      statusNames: statusNamesKey === '' ? [] : statusNamesKey.split(','),
      from: filter.from,
      to: filter.to,
      keyword: debouncedKeyword,
      includeClosed: filter.includeClosed,
      includeNoDate: filter.includeNoDate
    }),
    [
      projectIdsKey,
      assigneeIdsKey,
      statusNamesKey,
      filter.from,
      filter.to,
      debouncedKeyword,
      filter.includeClosed,
      filter.includeNoDate
    ]
  )

  useEffect(() => {
    if (!connection || !viewer || query.projectIds.length === 0) {
      setIssues([])
      setFetchedAt(null)
      return
    }
    const controller = new AbortController()
    // reloadToken は「再読込」ボタンのたびに増える。同じ条件でも取得をやり直すための
    // トリガーであり、キャッシュを無視するのはこのボタン経由のときだけ。
    const bypass = reloadToken > 0 && bypassCacheRef.current
    bypassCacheRef.current = false

    const run = async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const response = await getIssues(connection, query, bypass, controller.signal)
        setIssues(response.issues)
        setTruncated(response.truncated)
        setRequestCount(response.requestCount)
        setFetchedAt(response.fetchedAt)
      } catch (error: unknown) {
        if (isAbort(error)) {
          return
        }
        setLoadError(toMessage(error))
        setIssues([])
      } finally {
        setLoading(false)
      }
    }
    void run()

    return () => controller.abort()
  }, [connection, viewer, query, reloadToken])

  // --- URL 同期 ---

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const search = filterToParams(filter).toString()
    const next = `${window.location.pathname}${search === '' ? '' : `?${search}`}`
    window.history.replaceState(null, '', next)
  }, [filter])

  const handleReload = useCallback(() => {
    bypassCacheRef.current = true
    setReloadToken((value) => value + 1)
  }, [])

  const [copied, setCopied] = useState(false)
  const handleCopyUrl = useCallback(() => {
    const run = async () => {
      try {
        await navigator.clipboard.writeText(window.location.href)
        setCopied(true)
        setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
      } catch {
        setLoadError('URL のコピーに失敗しました')
      }
    }
    void run()
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
