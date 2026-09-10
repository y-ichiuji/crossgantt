import type { SyntheticEvent } from 'react'
import { useState } from 'react'

import type { Connection } from '../api'

type Props = {
  initial: Connection | null
  onSubmit: (connection: Connection) => void
  onCancel?: () => void
  connecting: boolean
  error: string | null
}

/** Backlog への接続情報を入力する画面。 */
export function ConnectPanel({ initial, onSubmit, onCancel, connecting, error }: Props) {
  const [space, setSpace] = useState(initial?.space ?? '')
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '')

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit({ space: space.trim(), apiKey: apiKey.trim() })
  }

  return (
    <div className="connect">
      <form className="connect__card" onSubmit={handleSubmit}>
        <h1 className="connect__title">CrossGantt for Backlog</h1>
        <p className="connect__lead">
          複数プロジェクト・複数担当者の課題を 1 枚のガントチャートで横断表示します。 Backlog のスペースドメインと API
          キーを入力してください。
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

        <label className="connect__field">
          <span>API キー</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Backlog の個人設定で発行したキー"
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
          <button type="submit" className="button button--primary" disabled={connecting}>
            {connecting ? '接続中…' : '接続する'}
          </button>
          {onCancel ? (
            <button type="button" className="button" onClick={onCancel} disabled={connecting}>
              キャンセル
            </button>
          ) : null}
        </div>

        <div className="connect__notes">
          <p>
            API キーは Backlog の「個人設定 → API」から発行できます。表示できる課題は、そのキーの持ち主が参加している
            プロジェクトに限られます。
          </p>
          <p className="connect__warning">
            入力した API キーはこのブラウザの localStorage にのみ保存され、サーバーには保存されません。 共用の PC
            では使用しないでください。
          </p>
        </div>
      </form>
    </div>
  )
}
