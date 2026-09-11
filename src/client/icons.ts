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

import { getIcons, isServerAvailable } from './api'

/** まとめて取りに行くまでの待ち時間（ミリ秒）。 */
const BATCH_DELAY_MS = 50

/** 1 回の呼び出しで頼む上限。サーバー側の上限に合わせる。 */
const MAX_PER_CALL = 60

type Listener = () => void

/** 取得済みのアイコン。取得できなかった場合は null を覚えて再取得しない。 */
const loaded = new Map<number, string | null>()

/** これから取りに行く ID。 */
const queued = new Set<number>()

const listeners = new Map<number, Set<Listener>>()

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
    queued.delete(userId)
    notify(userId)
  }
}

async function load(batch: number[]): Promise<void> {
  try {
    settle(batch, await getIcons(batch))
  } catch {
    // アイコンが出ないだけで画面は成立する。頭文字の表示に落とす。
    settle(batch, {})
  }
  if (queued.size > 0) {
    schedule()
  }
}

function flush(): void {
  timer = null
  const batch = [...queued].slice(0, MAX_PER_CALL)
  if (batch.length === 0) {
    return
  }
  void load(batch)
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
    const unsubscribe = subscribe(userId, () => setUrl(loaded.get(userId) ?? null))
    queued.add(userId)
    schedule()
    return unsubscribe
  }, [userId])

  return url
}

/** テスト用に取得済みのアイコンと待ち行列を捨てる。 */
export function resetIconCache(): void {
  loaded.clear()
  queued.clear()
  listeners.clear()
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}
