import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { isDateKey, todayKey } from '../shared/date'
import {
  clampRange,
  defaultFilter,
  encodeNameList,
  filterToQuery,
  parseFilter,
  parseIdList,
  parseNameList
} from '../shared/filter'
import { summarize } from '../shared/gantt'
import type {
  GanttIssue,
  IssuesQuery,
  Holiday,
  MemberSummary,
  ProjectSummary,
  StatusGroup,
  ViewFilter,
  Viewer
} from '../shared/types'
import {
  ApiError,
  getHolidays,
  getIssues,
  getMembers,
  getProjects,
  getSession,
  getStatuses,
  logout,
  startLogin
} from './api'
import { buildShareUrl, loadBootstrap } from './bootstrap'
import { FilterBar } from './components/FilterBar'
import { GanttChart } from './components/GanttChart'
import { LoginPanel } from './components/LoginPanel'
import { SummaryBar } from './components/SummaryBar'
import { loadFilterQuery, saveFilterQuery } from './filter-store'
import { refreshIcons, resetIconCache } from './icons'
import { loadLastSpace, saveLastSpace } from './storage'

import styles from './App.module.css'

/**
 * キーワード入力を取得リクエストへ反映するまでの待ち時間。
 *
 * 1 文字ごとに取り直すと、打ち終わる前に何度も Backlog を叩いてしまう。
 * 語を打ち切るまで待てる長さにしておく。
 */
const KEYWORD_DEBOUNCE_MS = 800

/** 表示条件を IndexedDB へ書き込むまでの待ち時間。連続した操作をまとめる。 */
const FILTER_SAVE_DEBOUNCE_MS = 500

/** 「コピーしました」の表示を戻すまでの時間。 */
const COPIED_FEEDBACK_MS = 1500

/** 認可フローが失敗したときにサーバーから渡される理由コードの説明。 */
const AUTH_ERROR_MESSAGES: Record<string, string | undefined> = {
  missing_code: '認可コードを受け取れませんでした。もう一度ログインしてください。',
  state_mismatch: '認可リクエストの照合に失敗しました。もう一度ログインしてください。',
  state_expired: '認可の有効期限が切れました。もう一度ログインしてください。',
  token_exchange_failed: 'アクセストークンの取得に失敗しました。もう一度ログインしてください。',
  session_write_failed: '他の操作と重なってログイン状態を保存できませんでした。もう一度ログインしてください。',
  not_configured: 'このアプリの OAuth 設定が未完了です。管理者に連絡してください。',
  access_denied: 'Backlog へのアクセスが許可されませんでした。'
}

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

/**
 * 共有 URL で絞り込みが明示されているか。
 *
 * 期間は既定値でも必ずクエリへ書き出すため、クエリが空でないことだけでは
 * 「利用者が条件を指定して開いた」ことにならない。認可後に戻ってきた場合も
 * 同じクエリが付くので、これを見分けないと保存済みの条件を既定値で
 * 上書きしてしまう。期間以外に既定値と違う項目があるかどうかで判断する。
 */
function hasExplicitSelection(filter: ViewFilter): boolean {
  const base = defaultFilter()
  return (
    filter.projectIds.length > 0 ||
    filter.assigneeIds.length > 0 ||
    filter.statusNames.length > 0 ||
    filter.keyword !== '' ||
    filter.groupBy !== base.groupBy ||
    filter.zoom !== base.zoom ||
    filter.includeClosed !== base.includeClosed ||
    filter.includeNoDate !== base.includeNoDate
  )
}

export default function App() {
  const [viewer, setViewer] = useState<Viewer | null>(null)
  /** セッション確認が終わるまでは画面を確定させない。 */
  const [sessionChecked, setSessionChecked] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  // 初期表示条件はサーバーが `doGet` で受け取ったクエリから復元する。
  // サンドボックス iframe の中からは、利用者が開いた URL は見えない。
  const [initialFilter] = useState<ViewFilter>(() => parseFilter(loadBootstrap().query))
  const [filter, setFilter] = useState<ViewFilter>(initialFilter)
  const [debouncedKeyword, setDebouncedKeyword] = useState(filter.keyword)
  /**
   * 前回の表示条件を IndexedDB から戻し終えたかどうか。
   *
   * 読み出しは非同期なので、終わる前に保存を始めると既定値で上書きしてしまう。
   */
  const [filterRestored, setFilterRestored] = useState(false)

  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [members, setMembers] = useState<MemberSummary[]>([])
  const [statuses, setStatuses] = useState<StatusGroup[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])

  const [issues, setIssues] = useState<GanttIssue[]>([])
  const [truncated, setTruncated] = useState(false)
  const [requestCount, setRequestCount] = useState(0)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  /**
   * 再読込ボタンを押すたびに増えるカウンタ。
   *
   * これを見る effect は複数あり、どれも「自分が前回走ったときから
   * 増えているか」でキャッシュを無視するかを決める。1 つが読み捨てる形に
   * すると他へ伝わらず、逆に取得が走らなかった回の指定が次へ持ち越される。
   */
  const [reloadToken, setReloadToken] = useState(0)
  const projectsReloadRef = useRef(reloadToken)
  const membersReloadRef = useRef(reloadToken)
  const issuesReloadRef = useRef(reloadToken)

  const today = useMemo(() => todayKey(), [])

  /**
   * 表示条件をクエリ文字列に畳んだもの。
   *
   * 共有 URL の組み立てと、認可後に表示条件を復元するための state に使う。
   */
  const filterQuery = useMemo(() => filterToQuery(filter), [filter])

  const patchFilter = useCallback((patch: Partial<ViewFilter>) => {
    setFilter((prev) => {
      const next = { ...prev, ...patch }
      // <input type="date"> は消去中や入力途中に空文字を送ってくる。そのまま取り込むと
      // 以降の日付計算が NaN になり、目盛りの生成で toISOString が RangeError を投げて
      // 画面が真っ白になる。妥当な DateKey でなければ直前の値を保つ。
      if (!isDateKey(next.from)) {
        next.from = prev.from
      }
      if (!isDateKey(next.to)) {
        next.to = prev.to
      }
      // 期間が逆転しないように補正する。
      if (next.to < next.from) {
        if (patch.from === undefined) {
          next.from = next.to
        } else {
          next.to = next.from
        }
      }
      // 描画量が現実的な範囲に収まるよう、期間の長さにも上限を設ける。
      const ranged = clampRange(next.from, next.to)
      next.from = ranged.from
      next.to = ranged.to
      return next
    })
  }, [])

  /** 401 を受けたらセッションを捨ててログイン画面へ戻す。 */
  const handleAuthFailure = useCallback((message: string) => {
    setViewer(null)
    setAuthError(message)
  }, [])

  const reportError = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.isUnauthorized) {
        handleAuthFailure(error.message)
        return
      }
      setLoadError(toMessage(error))
    },
    [handleAuthFailure]
  )

  // --- 認証 ---

  // 認可に失敗した場合の理由はサーバーから渡される。
  useEffect(() => {
    const code = loadBootstrap().authError
    if (code) {
      setAuthError(AUTH_ERROR_MESSAGES[code] ?? `ログインに失敗しました（${code}）`)
    }
  }, [])

  const handleLogin = useCallback(
    (space: string) => {
      setAuthError(null)
      saveLastSpace(space)
      try {
        setLoggingIn(true)
        // 認可画面への遷移は最上位フレームを動かすため、クリックと同じ
        // 同期処理の中で行う必要がある。
        startLogin(space, filterQuery)
      } catch (error: unknown) {
        setLoggingIn(false)
        setAuthError(toMessage(error))
      }
    },
    [filterQuery]
  )

  const handleLogout = useCallback(() => {
    const run = async () => {
      try {
        await logout()
      } catch (error: unknown) {
        // ログアウトの失敗は致命的ではないため、画面上はログアウト扱いにする。
        console.warn('logout failed', error)
      }
      setViewer(null)
      setProjects([])
      setMembers([])
      setStatuses([])
      setIssues([])
      setFetchedAt(null)
      setAuthError(null)
      // アイコンのキャッシュは素のユーザー ID 引きで、スペースをまたいで
      // 使い回すと別スペースの顔写真が出てしまう。ここで捨てる。
      resetIconCache()
      // 別スペース・別アカウントで入り直すと、残っているプロジェクト ID は
      // そのスペースには存在しない。保存済みの条件を読み直せるようにしておく。
      setFilterRestored(false)
    }
    void run()
  }, [])

  // 起動時にセッションの有無を確認する。
  useEffect(() => {
    const controller = new AbortController()
    const run = async () => {
      try {
        setViewer(await getSession(controller.signal))
      } catch (error: unknown) {
        if (isAbort(error)) {
          return
        }
        if (!(error instanceof ApiError && error.isUnauthorized)) {
          setLoadError(toMessage(error))
        }
        setViewer(null)
      } finally {
        setSessionChecked(true)
      }
    }
    void run()
    return () => controller.abort()
  }, [])

  // --- マスタ取得 ---

  useEffect(() => {
    // 再読込ボタン由来の実行なら、マスタもキャッシュを無視して取り直す。
    // そうしないと、新しく参加したプロジェクトが 30 分ぶん出てこない。
    const bypass = reloadToken !== projectsReloadRef.current
    projectsReloadRef.current = reloadToken
    if (!viewer) {
      return
    }
    const controller = new AbortController()
    const run = async () => {
      try {
        setProjects(await getProjects(bypass, controller.signal))
      } catch (error: unknown) {
        if (!isAbort(error)) {
          reportError(error)
        }
      }
    }
    void run()
    return () => controller.abort()
  }, [viewer, reloadToken, reportError])

  // --- 表示条件の保存と復元 ---

  // 前回の表示条件を IndexedDB から戻す。共有された URL で開かれたときは
  // そのクエリのほうが利用者の意図に近いので、保存済みの条件より優先する。
  useEffect(() => {
    if (!viewer || filterRestored) {
      return
    }
    if (hasExplicitSelection(initialFilter)) {
      setFilterRestored(true)
      return
    }
    let cancelled = false
    const run = async () => {
      const query = await loadFilterQuery(viewer.space)
      if (cancelled) {
        return
      }
      if (query !== null) {
        // 保存してあるのはクエリ文字列なので、URL 共有とまったく同じ経路で解釈する。
        // 壊れた値や過大な期間はここで正される。
        setFilter(parseFilter(query))
      }
      setFilterRestored(true)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [viewer, filterRestored, initialFilter])

  // 表示条件は変えるたびに保存し、次に開いたときの初期状態にする。
  // 復元より先に書くと既定値で上書きしてしまうため、復元の完了を待つ。
  useEffect(() => {
    if (!viewer || !filterRestored) {
      return
    }
    const timer = setTimeout(() => void saveFilterQuery(viewer.space, filterQuery), FILTER_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [viewer, filterRestored, filterQuery])

  // 依存配列をプリミティブだけで表現するため、配列は 1 つの文字列に畳む。
  // 畳み方と戻し方は共有層の規則をそのまま使う。ステータス名は利用者が
  // 自由に付けられて `,` を含みうるため、素の join では要素が壊れる。
  const projectIdsKey = filter.projectIds.join(',')
  const assigneeIdsKey = filter.assigneeIds.join(',')
  const statusNamesKey = encodeNameList(filter.statusNames)

  useEffect(() => {
    const bypass = reloadToken !== membersReloadRef.current
    membersReloadRef.current = reloadToken
    if (!viewer || projectIdsKey === '') {
      setMembers([])
      setStatuses([])
      return
    }
    const controller = new AbortController()
    const ids = parseIdList(projectIdsKey)
    const run = async () => {
      try {
        const [memberList, statusList] = await Promise.all([
          getMembers(ids, bypass, controller.signal),
          getStatuses(ids, bypass, controller.signal)
        ])
        setMembers(memberList)
        setStatuses(statusList)
      } catch (error: unknown) {
        if (!isAbort(error)) {
          reportError(error)
        }
      }
    }
    void run()
    return () => controller.abort()
  }, [viewer, projectIdsKey, reloadToken, reportError])

  // --- 祝日 ---

  useEffect(() => {
    if (!viewer) {
      setHolidays([])
      return
    }
    const controller = new AbortController()
    const run = async () => {
      try {
        setHolidays(await getHolidays(filter.from, filter.to, controller.signal))
      } catch (error: unknown) {
        // 祝日の背景が出ないだけなので、画面全体のエラーにはしない。
        if (!isAbort(error)) {
          setHolidays([])
        }
      }
    }
    void run()
    return () => controller.abort()
  }, [viewer, filter.from, filter.to])

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
      projectIds: parseIdList(projectIdsKey),
      assigneeIds: parseIdList(assigneeIdsKey),
      statusNames: parseNameList(statusNamesKey),
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
    // reloadToken は「再読込」ボタンのたびに増える。同じ条件でも取得をやり直すための
    // トリガーであり、キャッシュを無視するのはこのボタン経由のときだけ。
    const bypass = reloadToken !== issuesReloadRef.current
    issuesReloadRef.current = reloadToken

    if (!viewer || query.projectIds.length === 0) {
      setIssues([])
      setFetchedAt(null)
      // 取得中に条件が変わってここへ来ることがある。下ろさずに戻ると
      // 読み込み中の表示のまま固まり、再読込ボタンも絞り込みも押せなくなる。
      setLoading(false)
      return
    }
    const controller = new AbortController()

    const run = async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const response = await getIssues(query, bypass, controller.signal)
        setIssues(response.issues)
        setTruncated(response.truncated)
        setRequestCount(response.requestCount)
        setFetchedAt(response.fetchedAt)
      } catch (error: unknown) {
        if (isAbort(error)) {
          return
        }
        reportError(error)
        setIssues([])
      } finally {
        // 中断された場合は後続のリクエストがすでに走っている。ここで下ろすと
        // 読み込み中なのに完了扱いになり、再読込ボタンが押せてしまう。
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }
    void run()

    return () => controller.abort()
  }, [viewer, query, reloadToken, reportError])

  const handleReload = useCallback(() => {
    // アイコンはブラウザ側にも覚えてあるため、捨てないとサーバーだけ
    // 取り直して画面は古いままになる。
    refreshIcons()
    setReloadToken((value) => value + 1)
  }, [])

  const handleCopyUrl = useCallback(() => {
    const run = async () => {
      try {
        await navigator.clipboard.writeText(buildShareUrl(filterQuery))
        setCopied(true)
        setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
      } catch {
        setLoadError('URL のコピーに失敗しました')
      }
    }
    void run()
  }, [filterQuery])

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

  if (!sessionChecked) {
    return <output className={styles.loading}>読み込み中…</output>
  }

  if (!viewer) {
    return <LoginPanel initialSpace={loadLastSpace()} onSubmit={handleLogin} submitting={loggingIn} error={authError} />
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div>
            <h1 className={styles.title}>CrossGantt for Backlog</h1>
            <p className={styles.space}>
              {viewer.space} / {viewer.name}
            </p>
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={handleReload} disabled={loading}>
            再読込
          </button>
          <button type="button" className={styles.button} onClick={handleCopyUrl}>
            {copied ? 'コピーしました' : 'URL をコピー'}
          </button>
          <button type="button" className={styles.button} onClick={handleLogout}>
            ログアウト
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
        <p className={styles.error} role="alert">
          {loadError}
        </p>
      ) : null}

      {/*
       * 取得中はチャートの上に覆いをかける。表示中の内容が古いことを
       * 一目で分かるようにし、条件を変えた直後に「何も起きていない」ように
       * 見えるのを防ぐ。
       */}
      <div className={styles.chart}>
        {filter.projectIds.length === 0 ? (
          <div className={styles.empty}>
            <p>プロジェクトを 1 つ以上選択してください。</p>
          </div>
        ) : (
          <GanttChart
            issues={issues}
            filter={filter}
            today={today}
            projectNames={projectNames}
            holidays={holidays}
            loading={loading}
          />
        )}
        {loading ? (
          <div className={styles.loadingOverlay}>
            <output className={styles.loadingBadge}>
              <span className={styles.spinner} aria-hidden="true" />
              読み込み中…
            </output>
          </div>
        ) : null}
      </div>
    </div>
  )
}
