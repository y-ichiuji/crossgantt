/**
 * API ハンドラが利用者へ伝えたい失敗。
 *
 * `google.script.run` の失敗ハンドラに渡る例外は、メッセージが Apps Script 側で
 * 加工されてしまい、状態コードのような付加情報も落ちる。そのためハンドラは
 * この型で失敗を表し、ディスパッチャが必ず成否を包んだ値として返す。
 */
export class ApiFailure extends Error {
  /** HTTP の状態コードに相当する値。クライアントは 401 をログイン切れとして扱う。 */
  readonly status: number
  readonly detail: string | undefined

  constructor(status: number, message: string, detail?: string) {
    super(message)
    this.name = 'ApiFailure'
    this.status = status
    this.detail = detail
  }
}

/** 未ログイン・セッション切れ。クライアントはログイン画面へ戻す。 */
export function unauthorized(message: string): ApiFailure {
  return new ApiFailure(401, message)
}

/** 入力が不正。 */
export function badRequest(message: string, detail?: string): ApiFailure {
  return new ApiFailure(400, message, detail)
}
