/**
 * Cloudflare Cache API を使った短時間キャッシュ。
 *
 * Backlog の Search 区分レート制限を守るため、同一条件のリクエストは
 * 短時間だけキャッシュして再取得を避ける。キャッシュキーには API キーの
 * ハッシュを含め、別ユーザーのレスポンスが混ざらないようにする。
 */

/**
 * キー要素の区切り文字。
 *
 * 空白で連結すると、空白を含む要素（キーワードやステータス名）があるときに
 * 別々の条件が同じ文字列へ畳まれ、異なるクエリが同じキャッシュを引いてしまう。
 * そのため要素側に現れない NUL を使う。ソースへ生のバイトを埋め込むと
 * git がこのファイルをバイナリ扱いして差分を表示しなくなるので、
 * 必ずエスケープ表記で書く。
 */
const KEY_SEPARATOR = '\0'

/** 内部的なキャッシュキー用のダミーオリジン。実際にリクエストは発生しない。 */
const CACHE_ORIGIN = 'https://cache.crossgantt.internal'

/** 文字列群を SHA-256 でハッシュ化して 16 進文字列にする。 */
export async function hashKey(...parts: string[]): Promise<string> {
  const encoder = new TextEncoder()
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(parts.join(KEY_SEPARATOR)))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

type CacheStorageWithDefault = CacheStorage & { default?: Cache }

/** キャッシュキーとして使うダミーの Request。 */
function cacheRequest(namespace: string, hash: string): Request {
  return new Request(`${CACHE_ORIGIN}/${namespace}/${hash}`)
}

/** Workers 以外の実行環境（テストなど）ではキャッシュを使わない。 */
function getCache(): Cache | null {
  const store = (globalThis as { caches?: CacheStorageWithDefault }).caches
  return store?.default ?? null
}

/**
 * 呼び出し元が利用者へ返したい Cache-Control を退避しておくヘッダー。
 *
 * Worker 内キャッシュの寿命（`max-age=<ttl>`）と、ブラウザや経路上の
 * キャッシュへ与える指示は別物である。両者を同じヘッダーで表すと、
 * 保存時に上書きした値がそのまま利用者へ返ってしまい、`private` のような
 * 「共有キャッシュに載せるな」という指示が消える。退避して復元する。
 */
const CLIENT_CACHE_CONTROL_HEADER = 'x-cg-client-cache-control'

/** 任意のレスポンスをキャッシュから取り出す。無ければ null。 */
export async function matchCachedResponse(key: string): Promise<Response | null> {
  const cache = getCache()
  if (!cache) {
    return null
  }
  const hit = await cache.match(cacheRequest('raw', key))
  if (!hit) {
    return null
  }
  const clientCacheControl = hit.headers.get(CLIENT_CACHE_CONTROL_HEADER)
  if (clientCacheControl === null) {
    return hit
  }
  // 保存時に退避した、利用者向けの Cache-Control を復元して返す。
  const headers = new Headers(hit.headers)
  headers.delete(CLIENT_CACHE_CONTROL_HEADER)
  headers.set('Cache-Control', clientCacheControl)
  return new Response(hit.body, { headers })
}

/** 任意のレスポンスをキャッシュへ入れる。利用者向けの Cache-Control は保持する。 */
export async function putCachedResponse(key: string, response: Response, ttlSeconds: number): Promise<void> {
  const cache = getCache()
  if (!cache) {
    return
  }
  const headers = new Headers(response.headers)
  const clientCacheControl = headers.get('Cache-Control')
  if (clientCacheControl !== null) {
    headers.set(CLIENT_CACHE_CONTROL_HEADER, clientCacheControl)
  }
  headers.set('Cache-Control', `max-age=${ttlSeconds}`)
  await cache.put(cacheRequest('raw', key), new Response(response.body, { headers }))
}

/**
 * JSON を返す処理をキャッシュ付きで実行する。
 *
 * @param namespace キャッシュの用途を表す名前
 * @param keyParts キャッシュキーを構成する要素（API キーのハッシュを必ず含めること）
 * @param ttlSeconds キャッシュの有効秒数
 * @param bypass true なら既存のキャッシュを無視して再取得する
 */
export async function withJsonCache<T>(
  namespace: string,
  keyParts: string[],
  ttlSeconds: number,
  bypass: boolean,
  produce: () => Promise<T>
): Promise<T> {
  const cache = getCache()
  if (!cache) {
    return produce()
  }

  const cacheKey = cacheRequest(namespace, await hashKey(namespace, ...keyParts))

  if (!bypass) {
    const hit = await cache.match(cacheKey)
    if (hit) {
      return (await hit.json()) as T
    }
  }

  const value = await produce()
  const response = Response.json(value, {
    headers: { 'Cache-Control': `max-age=${ttlSeconds}` }
  })
  await cache.put(cacheKey, response)
  return value
}
