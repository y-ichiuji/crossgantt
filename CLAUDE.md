# CLAUDE.md

## このリポジトリについて

Backlog の複数プロジェクト・複数担当者の課題を 1 枚のガントチャートへ横断表示する読み取り専用ビューアです。
React 19 + Vite で作った画面を、Google Apps Script のウェブアプリとして配信します。

背景・API 連携の詳細は [`docs/design.md`](docs/design.md)、コマンドとセットアップは [`README.md`](README.md) にあります。

## アーキテクチャ

`src/client/`（React）、`src/shared/`（両方から import される純粋なロジック）、`src/server/`（Apps Script 上で動く同期処理）
の 3 層です。`src/shared/` は両方のバンドルに入るため、ブラウザ専用 API も Apps Script 専用 API も使えません。

Apps Script のグローバル（`UrlFetchApp` / `CacheService` / `PropertiesService` / `Utilities` / `LockService` /
`HtmlService`）に触れてよいのは **`src/server/gas/` だけ** です。`gas/runtime.ts` が各サービスを抽象へつないで
`ApiContext` を組み立て、`api.ts` 以下はその抽象しか見ません。新しいサービスを使いたくなったら `runtime.ts` に接続を足します。

クライアントからサーバーへの経路は `google.script.run.apiCall(name, paramsJson)` の 1 本だけで、入出力はどちらも
JSON 文字列です。`google.script.run` の失敗ハンドラでは例外の情報が落ちるため、戻り値は必ず成否を包んだ
`ApiEnvelope` にします。パラメータを URL クエリと同じ「値はすべて文字列」で表すのは、解釈（`shared/filter.ts` の
`parseIdList` など）をクライアントと共有するためです。

## Apps Script 由来の制約

`pnpm smoke` が機械的に検査します。破ると push は通るのに実行時に落ちます。

- **サーバー側は同期のみ**。`fetch` / `URL` / `URLSearchParams` / `setTimeout` / `crypto` / `document` は存在しない。
  代替は `src/server/fetcher.ts` の `buildUrl` / `encodeQuery`、`Utilities.sleep`、`Utilities.computeDigest`
- **`ScriptApp` に触れない**。参照するだけで承認スコープに「トリガーの管理」が加わり、利用者全員がそれを承認しないと画面が出ない
- **クライアントのバンドルは Base64 で運ぶ**。`HtmlService` はファイルの中身を HTML として解析するため、
  JavaScript の `i<n` をタグの開始と解釈してバンドルを静かに欠損させる。同じ理由で `gas/index.html` に書く
  スクリプトでは比較演算子の `<` を使わない（`i !== n` と書く）
- **`UrlFetchApp` は 2KB を超える URL を受け付けない**。プロジェクトを多数選ぶと `projectId[]` が並ぶため、
  課題取得は URL に収まる組へ分けて問い合わせ、課題 ID でマージする（`src/server/backlog/issues.ts`）

## レート制限とキャッシュ

Backlog のレート制限は区分ごとに 1 分あたりの回数で効きます。崩すと簡単に上限へ当たる要点が 2 つあります。

- マスタ情報は **プロジェクト単位** でキャッシュする。選択したプロジェクトの組をキーにすると、
  1 つ変えるだけで全件を取り直すことになる
- `CacheService` は 1 キー 100KB までなので、大きな応答は `src/server/cache.ts` が断片に分けて保持する

## セキュリティ上の前提

- 中継先は `*.backlog.jp` / `*.backlog.com` / `*.backlogtool.com` に限定する（`src/shared/space.ts`）。
  これを緩めるとアプリが任意ホストへの中継器になる
- アクセストークンはブラウザへ一切渡さず、サーバーの `UserProperties` にのみ置く
- Backlog はリフレッシュトークンをローテーションするため、トークン更新は `withLock` で直列化する

## 動作確認

`pnpm dev` は見た目を見るためのもので、Apps Script のサービスが無いため API とログインは動きません。
実際の動作は `pnpm run push`（ビルドして `clasp push`）で反映し、`/dev` の URL
（`https://script.google.com/macros/s/<スクリプト ID>/dev`）で確認します。`/dev` は常に最新の push を映すため、
デプロイを更新する必要はありません。リダイレクト URI は `/exec` 固定なので `/dev` からログインすると `/exec` 側へ
戻りますが、セッションは Google アカウント単位で残るため `/dev` を開き直せばログイン済みです。

## ブランチ運用

GitHub Flow。変更は短命なトピックブランチから PR を出し、`main` へマージされると
CI と CodeQL の両方が成功したのちに自動デプロイされます。
