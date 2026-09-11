/**
 * Backlog スペースドメインの検証。
 *
 * このアプリはクライアントから渡されたホストへリクエストを中継するため、
 * 検証を怠ると任意のホストへ中継できるオープンプロキシになってしまう。
 * 許可するのは Backlog が公式に使用しているドメインのみとする。
 */

const ALLOWED_SUFFIXES = ['.backlog.jp', '.backlog.com', '.backlogtool.com'] as const

/** サブドメイン部分に許可する文字。 */
const SUBDOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*$/u

/**
 * スペースドメインを正規化して返す。許可されない値の場合は null。
 *
 * 前後の空白、`https://` などのスキーム、末尾のスラッシュは受け付けて取り除く。
 */
export function normalizeSpace(input: string | null | undefined): string | null {
  if (!input) {
    return null
  }

  let value = input.trim().toLowerCase()
  value = value.replace(/^https?:\/\//u, '')
  // パス部分を落とす。`/\/.*$/` だと開始位置ごとに `.*` を試すため、
  // スラッシュの多い入力で実行時間が入力長の二乗に近づく。
  const slash = value.indexOf('/')
  if (slash !== -1) {
    value = value.slice(0, slash)
  }
  // ポート番号や認証情報が付いたホストは受け付けない。
  if (value.includes(':') || value.includes('@')) {
    return null
  }

  const suffix = ALLOWED_SUFFIXES.find((candidate) => value.endsWith(candidate))
  if (!suffix) {
    return null
  }

  const subdomain = value.slice(0, -suffix.length)
  if (!SUBDOMAIN_PATTERN.test(subdomain)) {
    return null
  }

  return value
}

/** 課題を Backlog 上で開くための URL。 */
export function issueUrl(space: string, issueKey: string): string {
  return `https://${space}/view/${issueKey}`
}
