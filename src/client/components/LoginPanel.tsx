import { useState } from 'react'
import type { SyntheticEvent } from 'react'

import styles from './LoginPanel.module.css'

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
    <div className={styles.screen}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <h1 className={styles.title}>CrossGantt for Backlog</h1>
        <p className={styles.lead}>
          複数プロジェクト・複数担当者の課題を 1 枚のガントチャートで横断表示します。 お使いの Backlog
          スペースを入力してログインしてください。
        </p>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>スペースドメイン</span>
          <input
            type="text"
            className={styles.input}
            value={space}
            onChange={(event) => setSpace(event.target.value)}
            placeholder="example.backlog.jp"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.buttons}>
          <button type="submit" className={styles.buttonPrimary} disabled={submitting}>
            {submitting ? 'Backlog へ移動しています…' : 'Backlog でログイン'}
          </button>
          {onCancel ? (
            <button type="button" className={styles.button} onClick={onCancel} disabled={submitting}>
              キャンセル
            </button>
          ) : null}
        </div>

        <div className={styles.notes}>
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
