/**
 * 担当者アイコンの読み込み。
 *
 * Cloudflare Workers 版では `/api/users/:id/icon` を `<img src>` から
 * 直接読んでいた。Apps Script の Web アプリには画像を返せる URL が無いため、
 * サーバーから data URL を受け取って `<img src>` に入れる。
 *
 * アイコンが必要になる箇所（ガント行・グループ見出し）は同時に数十個並ぶ。
 * 1 つずつ呼ぶと `google.script.run` の呼び出しが同じ数だけ走るので、
 * 少し待ってからまとめて 1 回で取りに行く。
 */

import { useEffect, useState } from 'react'

import { MAX_ICONS_PER_CALL } from '../shared/icons'
import { getIcons, isServerAvailable } from './api'

/** まとめて取りに行くまでの待ち時間（ミリ秒）。 */
const BATCH_DELAY_MS = 50

/** 1 回の呼び出しで頼む上限。サーバーと同じ値を共有層から取る。 */
const MAX_PER_CALL = MAX_ICONS_PER_CALL

type Listener = () => void

/** 取得済みのアイコン。取得できなかった場合は null を覚えて再取得しない。 */
const loaded = new Map<number, string | null>()

/** これから取りに行く ID。 */
const queued = new Set<number>()

/** いま取得中の ID。応答を待つ間に同じ ID を二重に頼まないための印。 */
const inFlight = new Set<number>()

/** 次の取得でサーバーのキャッシュを無視するかどうか。 */
let bypassCache = false

const listeners = new Map<number, Set<Listener>>()

/**
 * キャッシュを捨てた回数。
 *
 * 捨てる前に投げた取得が後から返ってくると、取り直したはずの表を
 * 古い値で埋め直してしまう。投げた時点の値と突き合わせて弾く。
 */
let generation = 0

let timer: ReturnType<typeof setTimeout> | null = null

function notify(userId: number): void {
  for (const listener of listeners.get(userId) ?? []) {
    listener()
  }
}

/** 取得の結果を覚えて、待っている購読者へ知らせる。 */
function settle(userIds: number[], icons: Record<string, string | undefined>): void {
  for (const userId of userIds) {
    loaded.set(userId, icons[userId] ?? null)
    inFlight.delete(userId)
    notify(userId)
  }
}

async function load(batch: number[], bypass: boolean): Promise<void> {
  const issued = generation
  try {
    const icons = await getIcons(batch, bypass)
    // 投げたあとにキャッシュを捨てていた場合、この応答は捨てた前の内容である。
    // 書き戻すと取り直したはずの表が古い値で埋まり直してしまう。
    if (issued !== generation) {
      return
    }
    settle(batch, icons)
  } catch {
    // アイコンが出ないだけで画面は成立する。頭文字の表示に落とす。
    if (issued !== generation) {
      return
    }
    settle(batch, {})
  }
  if (queued.size > 0) {
    schedule()
    return
  }
  // 待ち行列を出し切ったところでキャッシュ無視の指定を下ろす。1 便目だけで
  // 下ろすと、上限を超えた分が 2 便目以降でサーバーのキャッシュを引いてしまう。
  bypassCache = false
}

function flush(): void {
  timer = null
  // 送る分は待ち行列から外す。応答を待つ間に新しいアイコンが現れると
  // もう一度 flush が走るため、外しておかないと同じ ID をまとめて
  // 頼み直すことになる（アイコンはレート制限の区分がとりわけ厳しい）。
  const batch = [...queued].slice(0, MAX_PER_CALL)
  if (batch.length === 0) {
    return
  }
  for (const userId of batch) {
    queued.delete(userId)
    inFlight.add(userId)
  }
  void load(batch, bypassCache)
}

function schedule(): void {
  timer ??= setTimeout(flush, BATCH_DELAY_MS)
}

function subscribe(userId: number, listener: Listener): () => void {
  const set = listeners.get(userId) ?? new Set<Listener>()
  set.add(listener)
  listeners.set(userId, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) {
      listeners.delete(userId)
    }
  }
}

/**
 * 担当者のアイコンの data URL。未取得・取得できなかった場合は null。
 *
 * 同じ ID を複数の行が要求しても、取得は 1 回にまとまる。
 */
export function useAssigneeIcon(userId: number | null): string | null {
  const [url, setUrl] = useState<string | null>(() => (userId === null ? null : (loaded.get(userId) ?? null)))

  useEffect(() => {
    if (userId === null) {
      setUrl(null)
      return
    }
    /**
     * 覚えている値を画面へ写し、まだ無ければ取りに行く。
     *
     * 購読を張ったあとにも呼ばれる。`resetIconCache` はキャッシュを捨てたことを
     * 購読者へ知らせるので、ここで取り直しまで面倒を見ないと、行が作り直されない
     * 再読込では取得が一度も走らず画面が古いままになる。
     */
    const sync = (): void => {
      const known = loaded.get(userId)
      if (known !== undefined) {
        setUrl(known)
        return
      }
      setUrl(null)
      // サーバーがいない（ローカル開発やテスト）ときは取りに行かない。
      if (!isServerAvailable()) {
        return
      }
      if (!inFlight.has(userId)) {
        queued.add(userId)
        schedule()
      }
    }

    const unsubscribe = subscribe(userId, sync)
    sync()
    return unsubscribe
  }, [userId])

  return url
}

/**
 * 取得済みのアイコンと待ち行列を捨てる。
 *
 * このキャッシュはモジュールの寿命いっぱい生きる素の `userId` 引きなので、
 * ログアウトして別のスペースへ入り直すと、Backlog のユーザー ID が
 * スペースごとに独立している都合で他スペースの顔写真が出てしまう。
 * 見ているスペースが変わるところで必ず捨てる。
 *
 * 購読そのものは捨てない。購読は表示中の行が持っているものであってキャッシュの
 * 持ち物ではなく、捨ててしまうと「捨てたので取り直してほしい」を伝える相手が
 * いなくなる。代わりに全員へ知らせ、必要な行に取り直させる。
 */
export function resetIconCache(): void {
  loaded.clear()
  queued.clear()
  inFlight.clear()
  bypassCache = false
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  // 飛行中の取得が後から書き戻すのを防ぐ。知らせるより先に上げる。
  generation += 1
  for (const set of listeners.values()) {
    for (const listener of set) {
      listener()
    }
  }
}

/** 覚えているアイコンを捨て、次の取得ではサーバーのキャッシュも無視する。 */
export function refreshIcons(): void {
  resetIconCache()
  bypassCache = true
}
