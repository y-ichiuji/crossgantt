/**
 * Apps Script の各サービスを、サーバー実装が使う抽象へつなぐ層。
 *
 * ここだけが `UrlFetchApp` や `PropertiesService` といったグローバルに触る。
 * 上位のモジュールは同期的な関数と単純な型だけを見ているため、テストでは
 * Apps Script を模さずに済む。
 */

import type { ApiContext } from '../api'
import type { OAuthConfig } from '../auth/oauth'
import type { UserStore } from '../auth/session'
import { createJsonCache } from '../cache'
import type { CacheStore, JsonCache } from '../cache'
import type { Fetcher, FetchRequest, FetchResponse, Sleeper } from '../fetcher'

/** スクリプトプロパティのキー。 */
const PROPERTY_CLIENT_ID = 'BACKLOG_CLIENT_ID'
const PROPERTY_CLIENT_SECRET = 'BACKLOG_CLIENT_SECRET'
const PROPERTY_REDIRECT_URI = 'OAUTH_REDIRECT_URI'
const PROPERTY_WEB_APP_URL = 'WEB_APP_URL'

/** CacheService が受け付ける保持秒数の上限（6 時間）。 */
const MAX_CACHE_TTL_SECONDS = 21_600

/** トークン更新のロックを待つ上限（ミリ秒）。 */
const LOCK_TIMEOUT_MS = 20_000

export type GasSettings = {
  /** クライアント ID かシークレットが未設定なら null。 */
  oauth: OAuthConfig | null
  /** 共有用に表に出す Web アプリの URL。 */
  webAppUrl: string
}

/** ヘッダー名を小文字に揃え、複数値はカンマで連結する。 */
function normalizeHeaders(raw: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw)) {
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value)
  }
  return headers
}

function toUrlFetchRequest(request: FetchRequest): GoogleAppsScript.URL_Fetch.URLFetchRequest {
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequest = {
    url: request.url,
    method: request.method ?? 'get',
    headers: request.headers ?? {},
    // HTTP のエラーステータスは例外にせず、呼び出し側で状態コードとして扱う。
    muteHttpExceptions: true,
    followRedirects: true
  }
  if (request.contentType !== undefined) {
    options.contentType = request.contentType
  }
  if (request.payload !== undefined) {
    options.payload = request.payload
  }
  return options
}

function toFetchResponse(response: GoogleAppsScript.URL_Fetch.HTTPResponse): FetchResponse {
  // ヘッダーの取得もコストがかかるため、必要になってから読む。
  let headers: Record<string, string> | null = null
  return {
    status: response.getResponseCode(),
    header: (name) => {
      headers ??= normalizeHeaders(response.getAllHeaders() as Record<string, unknown>)
      return headers[name.toLowerCase()] ?? null
    },
    text: () => response.getContentText(),
    base64: () => Utilities.base64Encode(response.getContent())
  }
}

/** `UrlFetchApp.fetchAll` を `Fetcher` として使えるようにする。 */
export function createFetcher(): Fetcher {
  return (requests) => UrlFetchApp.fetchAll(requests.map(toUrlFetchRequest)).map(toFetchResponse)
}

/** `Utilities.sleep` を `Sleeper` として使えるようにする。 */
export function createSleeper(): Sleeper {
  return (ms) => {
    Utilities.sleep(ms)
  }
}

/** SHA-256 の 16 進表現。`Utilities.computeDigest` は符号付きバイトを返す。 */
export function sha256Hex(input: string): string {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8)
  return bytes.map((byte) => ((byte + 256) % 256).toString(16).padStart(2, '0')).join('')
}

/** 推測不能な 16 進文字列。 */
export function randomToken(): string {
  return Utilities.getUuid().split('-').join('')
}

function createCacheStore(cache: GoogleAppsScript.Cache.Cache): CacheStore {
  return {
    get: (key) => cache.get(key),
    getAll: (keys) => cache.getAll(keys),
    putAll: (values, ttlSeconds) => {
      cache.putAll(values, Math.min(ttlSeconds, MAX_CACHE_TTL_SECONDS))
    }
  }
}

/** 利用者ごとのキャッシュ。Backlog の応答はここへ入れる。 */
export function createUserCache(): JsonCache {
  return createJsonCache(createCacheStore(CacheService.getUserCache()), sha256Hex)
}

/** スクリプト共通のキャッシュ。祝日のように利用者に依存しない情報を入れる。 */
export function createSharedCache(): JsonCache {
  return createJsonCache(createCacheStore(CacheService.getScriptCache()), sha256Hex)
}

/**
 * 利用者ごとの永続領域。
 *
 * Web アプリを「アクセスしているユーザーとして実行」で公開すると、
 * ここは Google アカウントごとに分かれた領域になる。
 */
export function createUserStore(): UserStore {
  const properties = PropertiesService.getUserProperties()
  return {
    get: (key) => properties.getProperty(key),
    put: (key, value) => {
      properties.setProperty(key, value)
    },
    remove: (key) => {
      properties.deleteProperty(key)
    }
  }
}

/**
 * スクリプトプロパティから設定を読む。
 *
 * Web アプリの URL は `ScriptApp.getService().getUrl()` でも取れるが、
 * 使わない。Apps Script の承認スコープはコードの静的解析で決まるため、
 * `ScriptApp` に触れるだけで「トリガーの管理」まで含む重いスコープを
 * 利用者全員に承認させることになる。この画面に必要なのは外部サービスへの
 * 接続だけなので、URL は設定で受け取る。
 *
 * `getUrl()` は「いま開いているデプロイ」の URL を返すという性質もあり、
 * `/dev` で開くとリダイレクト URI が食い違う。設定で固定するほうが確実である。
 */
export function resolveSettings(): GasSettings {
  const properties = PropertiesService.getScriptProperties()
  const clientId = properties.getProperty(PROPERTY_CLIENT_ID) ?? ''
  const clientSecret = properties.getProperty(PROPERTY_CLIENT_SECRET) ?? ''
  // Backlog に登録したリダイレクト URI と完全に一致させる必要がある。
  const redirectUri =
    properties.getProperty(PROPERTY_REDIRECT_URI) ?? properties.getProperty(PROPERTY_WEB_APP_URL) ?? ''
  const webAppUrl = properties.getProperty(PROPERTY_WEB_APP_URL) ?? redirectUri

  return {
    // リダイレクト URI が無いと認可を始められないため、未設定は未完了として扱う。
    oauth: clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null,
    webAppUrl
  }
}

/**
 * 同時に走ると壊れる処理を直列化する。
 *
 * ロックが取れなかった場合も処理は続ける。待ち続けて実行時間を使い切るより、
 * 二重に走る可能性を受け入れたほうが利用者にとって害が小さい。
 */
function withLock<T>(produce: () => T): T {
  const lock = LockService.getUserLock()
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    return produce()
  }
  try {
    return produce()
  } finally {
    lock.releaseLock()
  }
}

/** Apps Script のサービス群から API の実行文脈を組み立てる。 */
export function createApiContext(settings: GasSettings): ApiContext {
  return {
    now: () => Date.now(),
    store: createUserStore(),
    cache: createUserCache(),
    sharedCache: createSharedCache(),
    fetcher: createFetcher(),
    sleep: createSleeper(),
    oauth: settings.oauth,
    withLock,
    log: (message, error) => {
      console.error(message, error)
    }
  }
}
