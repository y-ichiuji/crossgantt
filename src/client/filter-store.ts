/**
 * 表示条件のブラウザ保存（IndexedDB）。
 *
 * 次に開いたときも前回と同じ条件で始められるように、直近の表示条件を
 * 1 件だけ持つ。保存するのは `filterToParams` が組み立てるクエリ文字列で、
 * 読み出した値は `parseFilter` に通して使う。URL 共有とまったく同じ経路を
 * 通すことで、壊れた値・期間の逆転・過大な期間はそこで正され、保存形式だけが
 * 別に腐っていくこともない。
 *
 * 保存した値は「そのスペースで選んだ条件」なので、スペースも一緒に持つ。
 * プロジェクト ID も担当者 ID もスペースごとの採番なので、別スペースへ
 * ログインし直したときに流用すると存在しない ID を問い合わせてしまう。
 *
 * 秘密情報は一切置かない（認証情報はサーバー側のセッションで扱う）。
 */

const DB_NAME = 'crossgantt'
const DB_VERSION = 1
const STORE_NAME = 'settings'
const FILTER_KEY = 'viewFilter'

/** IndexedDB に書き込むレコード。 */
type StoredFilter = {
  /** 保存した時点で見ていたスペースドメイン。 */
  space: string
  /** `filterToParams` が組み立てたクエリ文字列（`?` は含まない）。 */
  query: string
}

/**
 * 開いたデータベース。
 *
 * 表示条件は変えるたびに書き込むため、そのつど開き直すと接続が積み上がる。
 * 一度だけ開いて使い回す。開けなかった場合は null を覚え、以降は黙って
 * 保存なしで動く（プライベートブラウジングなどで開けないことがある）。
 */
let connection: Promise<IDBDatabase | null> | null = null

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    request.addEventListener('upgradeneeded', () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    })
    request.addEventListener('success', () => resolve(request.result))
    // 表示条件の保存は「できたら嬉しい」程度の機能なので、失敗しても
    // 画面には出さない。開けなければ保存なしで動かす。
    request.addEventListener('error', () => resolve(null))
    request.addEventListener('blocked', () => resolve(null))
  })
}

function database(): Promise<IDBDatabase | null> {
  connection ??= openDatabase()
  return connection
}

/** 1 回のトランザクションを Promise として扱う。失敗はすべて null に畳む。 */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  const db = await database()
  if (!db) {
    return null
  }
  return new Promise((resolve) => {
    let request: IDBRequest<T>
    try {
      request = run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME))
    } catch {
      resolve(null)
      return
    }
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () => resolve(null))
  })
}

/**
 * 保存済みの表示条件クエリを読む。
 *
 * 保存が無い / 読めない / 別スペースのものだった場合は null。
 */
export async function loadFilterQuery(space: string): Promise<string | null> {
  const stored = await withStore<StoredFilter | undefined>(
    'readonly',
    (store) => store.get(FILTER_KEY) as IDBRequest<StoredFilter | undefined>
  )
  if (!stored || typeof stored.query !== 'string' || stored.space !== space) {
    return null
  }
  return stored.query
}

/** 表示条件クエリを保存する。書き込めなくても呼び出し側へは伝えない。 */
export async function saveFilterQuery(space: string, query: string): Promise<void> {
  const record: StoredFilter = { space, query }
  await withStore('readwrite', (store) => store.put(record, FILTER_KEY))
}

/** テスト用に開いたデータベースを手放す。 */
export function resetFilterStore(): void {
  const opened = connection
  connection = null
  void opened?.then((db) => db?.close())
}
