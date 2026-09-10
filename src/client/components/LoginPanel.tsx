import { useState } from 'react'
import type { SyntheticEvent } from 'react'

type Props = {
  initialSpace: string
  onSubmit: (space: string) => void
  onCancel?: () => void
  submitting: boolean
  error: string | null
}

/** Backlog のスペースを指定して OAuth ログインを開始する画面。 */
export function LoginPanel({ initialSpace, onSubmit, onCancel, submitting, error }: Props) {
  const [space, setSpace] = useState(initialSpace)

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit(space.trim())
  }

  return (
    <div className="connect">
      <form className="connect__card" onSubmit={handleSubmit}>
        <h1 className="connect__title">CrossGantt for Backlog</h1>
        <p className="connect__lead">
          複数プロジェクト・複数担当者の課題を 1 枚のガントチャートで横断表示します。 お使いの Backlog
          スペースを入力してログインしてください。
        </p>

        <label className="connect__field">
          <span>スペースドメイン</span>
          <input
            type="text"
            value={space}
            onChange={(event) => setSpace(event.target.value)}
            placeholder="example.backlog.jp"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>

        {error ? (
          <p className="connect__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="connect__buttons">
          <button type="submit" className="button button--primary" disabled={submitting}>
            {submitting ? 'Backlog へ移動しています…' : 'Backlog でログイン'}
          </button>
          {onCancel ? (
            <button type="button" className="button" onClick={onCancel} disabled={submitting}>
              キャンセル
            </button>
          ) : null}
        </div>

        <div className="connect__notes">
          <p>
            Backlog の認可画面に移動します。許可すると、あなたが参加しているプロジェクトの課題を
            読み取り専用で表示します。このアプリが Backlog を更新することはありません。
          </p>
          <p>
            アクセストークンはサーバー側のセッションにのみ保存され、ブラウザには HttpOnly Cookie のセッション ID
            だけが渡ります。
          </p>
        </div>
      </form>
    </div>
  )
}
