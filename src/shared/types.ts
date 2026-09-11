/**
 * クライアントとサーバーで共有する型定義。
 */

/** ガントチャート描画用に正規化した課題。 */
export type GanttIssue = {
  id: number
  issueKey: string
  summary: string
  url: string
  projectId: number
  projectKey: string
  assigneeId: number | null
  assigneeName: string | null
  statusId: number
  statusName: string
  statusColor: string | null
  isClosed: boolean
  /** yyyy-MM-dd 形式。未設定の場合は null。 */
  startDate: string | null
  /** yyyy-MM-dd 形式。未設定の場合は null。 */
  dueDate: string | null
  estimatedHours: number | null
  actualHours: number | null
  parentIssueId: number | null
  milestoneNames: string[]
}

/** プロジェクト選択肢。 */
export type ProjectSummary = {
  id: number
  projectKey: string
  name: string
}

/** 担当者選択肢。 */
export type MemberSummary = {
  id: number
  name: string
}

/**
 * ステータス選択肢。複数プロジェクトで同名・別 ID のステータスが存在しうるため、
 * 名前で束ねたうえで対応する ID 群を保持する。
 */
export type StatusGroup = {
  name: string
  color: string | null
  ids: number[]
  isClosed: boolean
}

/** 接続中のユーザー情報。 */
export type Viewer = {
  id: number
  userId: string | null
  name: string
  space: string
}

/** ガント行のグルーピング軸。 */
export type GroupBy = 'assignee' | 'project' | 'milestone'

/** タイムラインのズームレベル。 */
export type Zoom = 'day' | 'week' | 'month'

/** 表示条件。URL クエリパラメータと 1:1 で対応する。 */
export type ViewFilter = {
  projectIds: number[]
  assigneeIds: number[]
  statusNames: string[]
  /** yyyy-MM-dd */
  from: string
  /** yyyy-MM-dd */
  to: string
  keyword: string
  groupBy: GroupBy
  zoom: Zoom
  includeClosed: boolean
  includeNoDate: boolean
}

/**
 * 課題取得に影響する条件だけを取り出したもの。
 *
 * グルーピング軸とズームはクライアント側だけで完結するため含めない。
 * これらを含めてしまうと、表示を切り替えただけで再取得が走ってしまう。
 */
export type IssuesQuery = Pick<
  ViewFilter,
  'projectIds' | 'assigneeIds' | 'statusNames' | 'from' | 'to' | 'keyword' | 'includeClosed' | 'includeNoDate'
>

/** /api/issues のレスポンス。 */
export type IssuesResponse = {
  issues: GanttIssue[]
  /** ページング上限に達して打ち切った場合 true。 */
  truncated: boolean
  /** Backlog へ実際に投げたリクエスト数。 */
  requestCount: number
  fetchedAt: string
}

/** API エラーレスポンスの本文。 */
/** 祝日 1 日分。 */
export type Holiday = {
  /** yyyy-MM-dd */
  dateKey: string
  name: string
}

export type ApiErrorBody = {
  error: string
  detail?: string
}

/**
 * API 呼び出し 1 回の結果。
 *
 * `google.script.run` の失敗ハンドラに渡る例外はメッセージが加工され、
 * 状態コードのような付加情報も落ちる。そのため成否はこの形で包んで返す。
 */
export type ApiEnvelope =
  | { ok: true; data: unknown }
  | { ok: false; status: number; error: string; detail: string | null }

/**
 * 画面の起動時にサーバーから渡す設定。
 *
 * Apps Script の Web アプリはサンドボックス iframe の中で動くため、
 * 表示中の URL からは何も読み取れない。初期表示条件も共有用の URL も
 * ここでサーバーから受け取る。
 */
export type Bootstrap = {
  /** 共有用に使う Web アプリの URL（/exec）。取得できない場合は空文字。 */
  webAppUrl: string
  /** 初期表示条件のクエリ文字列（`?` は含まない）。 */
  query: string
  /** OAuth のクライアント ID とシークレットが設定済みかどうか。 */
  configured: boolean
  clientId: string
  /** Backlog に登録したリダイレクト URI。 */
  redirectUri: string
  /** 認可リクエストの state に載せる、払い出し済みの nonce。 */
  nonce: string
  /** 直前の認可が失敗した場合の理由コード。 */
  authError: string | null
}
