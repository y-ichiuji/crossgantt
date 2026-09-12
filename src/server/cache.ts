/**
 * Apps Script の CacheService を使った短時間キャッシュ。
 *
 * Backlog の Search 区分レート制限を守るため、同一条件のリクエストは
 * 短時間だけキャッシュして再取得を避ける。
 *
 * CacheService は 1 キーあたり 100KB 程度までしか保持できないため、
 * 大きな JSON は分割して複数キーへ書き込み、本体のキーには断片数だけを置く。
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

/**
 * 1 つの断片に入れる最大文字数。
 *
 * CacheService の上限はバイト数で効くため、日本語（UTF-8 で 1 文字 3 バイト）
 * だけが並んでも 100KB を超えないところに取っている。
 */
const CHUNK_LENGTH = 30_000

/**
 * 1 つの値に許す断片数の上限。
 *
 * これを超える巨大な応答はキャッシュを諦める。キャッシュ全体の容量を
 * 一度の取得で使い切ってしまうと、他の条件のキャッシュまで押し出してしまう。
 *
 * プロジェクトを数十個選ぶと課題の応答は数千件になる。そこでキャッシュを
 * 諦めると、絞り込みを変えるたびに取り直してレート制限へ届いてしまうため、
 * 3,000 件程度までは収まる上限にしている。
 */
const MAX_CHUNKS = 40

/** キャッシュの読み書き。Apps Script では CacheService の Cache に対応する。 */
export type CacheStore = {
  get: (key: string) => string | null
  getAll: (keys: string[]) => Record<string, string | undefined>
  putAll: (values: Record<string, string>, ttlSeconds: number) => void
}

/** 文字列を固定長の文字列へ畳む関数。Apps Script では SHA-256 を使う。 */
export type Hasher = (input: string) => string

/** 断片数を記録する本体の値。 */
type Manifest = { chunks: number }

function isManifest(value: unknown): value is Manifest {
  return typeof value === 'object' && value !== null && typeof (value as Manifest).chunks === 'number'
}

/**
 * 断片へ分ける。
 *
 * 長さは UTF-16 のコードユニットで数えるが、サロゲートペアの途中では切らない。
 * 途中で切ると断片の端に上位・下位サロゲートが単独で残り、CacheService が
 * 文字列を UTF-8 で保持する際に置換文字へ変わって復元できなくなる。
 * 課題の件名に絵文字が含まれていれば現実に起こりうる。
 */
function splitChunks(text: string): string[] {
  const chunks: string[] = []
  let index = 0
  while (index < text.length) {
    let end = Math.min(index + CHUNK_LENGTH, text.length)
    // 末尾がサロゲートペアの前半なら、そのペアごと次の断片へ送る。
    // `codePointAt` が 0xFFFF を超える値を返すのは、その位置から
    // ペアで 1 文字を成しているときだけ。
    if (end < text.length && (text.codePointAt(end - 1) ?? 0) > 0xff_ff) {
      end -= 1
    }
    chunks.push(text.slice(index, end))
    index = end
  }
  return chunks
}

export type JsonCache = {
  /** キャッシュキーに使う、要素をまとめたハッシュ。 */
  hashKey: (...parts: string[]) => string
  /** 文字列をそのまま読む。画像の Base64 のように JSON でない値に使う。 */
  readText: (namespace: string, keyParts: string[]) => string | null
  /** 文字列をそのまま書く。 */
  writeText: (namespace: string, keyParts: string[], value: string, ttlSeconds: number) => void
  /**
   * JSON を返す処理をキャッシュ付きで実行する。
   *
   * `produce` が `undefined` を返した場合は結果を保持しない。取得に失敗した
   * ことを表す値をキャッシュすると、外部サービスが復旧しても期限が切れるまで
   * 失敗した状態を配り続けることになる。
   *
   * @param namespace キャッシュの用途を表す名前
   * @param keyParts キャッシュキーを構成する要素
   * @param ttlSeconds キャッシュの有効秒数
   * @param bypass true なら既存のキャッシュを無視して取り直す
   */
  withJson: <T>(namespace: string, keyParts: string[], ttlSeconds: number, bypass: boolean, produce: () => T) => T
}

/** キャッシュを持たない実装。テストや CacheService が使えない場面で使う。 */
export function createNullJsonCache(hash: Hasher = (input) => input): JsonCache {
  return {
    hashKey: (...parts) => hash(parts.join(KEY_SEPARATOR)),
    readText: () => null,
    writeText: () => {
      // 保持しない。
    },
    withJson: (_namespace, _keyParts, _ttlSeconds, _bypass, produce) => produce()
  }
}

/** CacheStore の上に JSON の読み書きを組み立てる。 */
export function createJsonCache(store: CacheStore, hash: Hasher): JsonCache {
  const hashKey = (...parts: string[]): string => hash(parts.join(KEY_SEPARATOR))

  const entryKey = (namespace: string, keyParts: string[]): string => `${namespace}:${hashKey(namespace, ...keyParts)}`

  const readRaw = (key: string): string | null => {
    const head = store.get(key)
    if (head === null) {
      return null
    }
    let manifest: unknown
    try {
      manifest = JSON.parse(head)
    } catch {
      return null
    }
    if (!isManifest(manifest) || manifest.chunks < 1 || manifest.chunks > MAX_CHUNKS) {
      return null
    }
    const chunkKeys = Array.from({ length: manifest.chunks }, (_, index) => `${key}#${index}`)
    const chunks = store.getAll(chunkKeys)
    const parts: string[] = []
    for (const chunkKey of chunkKeys) {
      const chunk = chunks[chunkKey]
      // 断片ごとに期限が来るため、一部だけ落ちていることがある。
      // 途中が欠けた値は復元できないので、まるごと取り直す。
      if (chunk === undefined) {
        return null
      }
      parts.push(chunk)
    }
    return parts.join('')
  }

  const writeRaw = (key: string, text: string, ttlSeconds: number): void => {
    const chunks = splitChunks(text)
    if (chunks.length > MAX_CHUNKS) {
      // 書けないまま黙って戻ると、同じキーに残っている古い（小さかった頃の）
      // 値がそのまま返り続ける。再読込した直後に更新前の内容へ戻って見えるため、
      // 復元できない目印を書いて既存の値を無効にする。断片は参照されなくなり、
      // それぞれの期限で消える。
      store.putAll({ [key]: JSON.stringify({ chunks: 0 }) }, ttlSeconds)
      return
    }
    const values: Record<string, string> = { [key]: JSON.stringify({ chunks: chunks.length }) }
    for (const [index, chunk] of chunks.entries()) {
      values[`${key}#${index}`] = chunk
    }
    store.putAll(values, ttlSeconds)
  }

  return {
    hashKey,
    readText: (namespace, keyParts) => readRaw(entryKey(namespace, keyParts)),
    writeText: (namespace, keyParts, value, ttlSeconds) => {
      writeRaw(entryKey(namespace, keyParts), value, ttlSeconds)
    },
    withJson: <T>(namespace: string, keyParts: string[], ttlSeconds: number, bypass: boolean, produce: () => T): T => {
      const key = entryKey(namespace, keyParts)
      if (!bypass) {
        const raw = readRaw(key)
        if (raw !== null) {
          try {
            return JSON.parse(raw) as T
          } catch {
            // 壊れた値は無視して取り直す。
          }
        }
      }
      const value = produce()
      // undefined は「保持しない」の合図。JSON にも書けない値なので、
      // キャッシュ可能な値と取り違える心配がない。
      if (value !== undefined) {
        writeRaw(key, JSON.stringify(value), ttlSeconds)
      }
      return value
    }
  }
}
