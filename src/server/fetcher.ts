/**
 * 外部 HTTP 呼び出しの抽象。
 *
 * Apps Script には `fetch` も `Response` も `URL` も存在せず、代わりに
 * `UrlFetchApp` が同期的に応答を返す。非同期を前提にした型をそのまま使うと
 * 実装側で嘘をつくことになるため、この層は最初から同期で定義している。
 *
 * まとめて投げる形にしているのは `UrlFetchApp.fetchAll` に素直に対応させるため。
 * 1 本だけ投げる場合も長さ 1 の配列として扱う。
 */

export type QueryValue = string | number | boolean | null | undefined | (string | number)[]
export type QueryParams = Record<string, QueryValue>

/**
 * クエリ文字列を組み立てる。空文字・null・undefined の項目は落とす。
 *
 * 配列は同じキーを繰り返す形（`projectId[]=1&projectId[]=2`）に展開する。
 * Backlog API はこの形式で複数値を受け取る。
 */
export function encodeQuery(params: QueryParams): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') {
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`)
      }
      continue
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  }
  return parts.join('&')
}

/** パスとクエリから URL を組み立てる。 */
export function buildUrl(origin: string, path: string, params: QueryParams = {}): string {
  const query = encodeQuery(params)
  return query === '' ? `${origin}${path}` : `${origin}${path}?${query}`
}

export type FetchRequest = {
  url: string
  method?: 'get' | 'post'
  headers?: Record<string, string>
  contentType?: string
  payload?: string
}

export type FetchResponse = {
  status: number
  /** ヘッダー名は大文字小文字を区別せずに引ける。 */
  header: (name: string) => string | null
  text: () => string
  /** 画像などをそのまま持ち回るための Base64 表現。 */
  base64: () => string
}

/**
 * 複数のリクエストをまとめて投げる。
 *
 * 通信そのものに失敗した場合（名前解決やタイムアウト）は例外を投げてよい。
 * HTTP のエラーステータスは例外にせず、`status` として返すこと。
 */
export type Fetcher = (requests: FetchRequest[]) => FetchResponse[]

/** 指定ミリ秒だけ待つ。Apps Script では `Utilities.sleep` に対応する。 */
export type Sleeper = (ms: number) => void
