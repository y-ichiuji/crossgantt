# CrossGantt for Backlog

Backlog の**複数プロジェクト × 複数担当者**の課題を、1 枚のガントチャートで横断表示するビューアです。

Backlog 標準のガントチャートは 1 プロジェクト単位でしか表示できないため、掛け持ちしているメンバーの負荷や、プロジェクトをまたいだ期日の衝突が見えません。このアプリはそこを埋めます。

## できること

- 複数プロジェクト・複数担当者の課題を 1 つのタイムラインに描画
- **担当者別 / プロジェクト別 / マイルストーン別**のグルーピング切り替え
- 日 / 週 / 月のズーム、今日の縦線、土日の背景
- 期限超過かつ未完了の課題を警告色でハイライトし、グループごとの遅延件数を表示
- 課題バーのクリックで Backlog の該当課題を新規タブで開く
- 表示条件がすべて URL に載るので、そのままチームへリンク共有できる
- ライト / ダークテーマの自動切り替え

### やらないこと

- ガント上での編集（読み取り専用です。Backlog を更新する API は一切呼びません）
- 複数スペースの横断（1 セッションにつき 1 スペース）
- 課題間の依存矢印 — Backlog に先行 / 後続という順序依存の概念がないため、原理的に描けません

## 使い方

1. アプリを開き、Backlog のスペースドメイン（例: `example.backlog.jp`）を入力します
2. 「Backlog でログイン」を押すと Backlog の認可画面に移動するので、許可します
3. アプリに戻ったらプロジェクトを選ぶとガントチャートが表示されます

表示できる課題は、ログインしたユーザーが参加しているプロジェクトに限られます（Backlog 側の権限がそのまま効きます）。

### 認証の仕組み

Backlog の **OAuth 2.0** でログインします。

- アクセストークンとリフレッシュトークンは **Cloudflare KV 上のセッションにのみ保存**され、ブラウザには渡りません
- ブラウザが持つのは HttpOnly / Secure / SameSite=Lax な Cookie に入ったセッション ID だけです
- アクセストークンは有効期限が近づくとサーバー側で自動的に更新されます
- CSRF 対策として、認可リクエストの `state` を KV と Cookie の両方に持たせて突き合わせます

### OAuth アプリの登録（セルフホストする場合）

[Backlog Developer サイト](https://backlog.com/developer/applications/)でアプリを登録し、リダイレクト URI に次を設定します。

```
https://<worker のドメイン>/api/auth/callback
```

Backlog は 1 アプリにつき 1 つのリダイレクト URI しか登録できないため、ローカル開発でもログインを試したい場合は
`http://localhost:5173/api/auth/callback` を設定した別アプリを登録してください。

取得したクライアント ID とシークレットを設定します。

```sh
npx wrangler secret put BACKLOG_CLIENT_ID
npx wrangler secret put BACKLOG_CLIENT_SECRET
```

ローカル開発では `.dev.vars.example` を `.dev.vars` にコピーして値を入れてください（`.dev.vars` は `.gitignore` 済みです）。

セッション保存用の KV 名前空間も必要です。

```sh
npx wrangler kv namespace create SESSIONS
# 出力された id を wrangler.jsonc の kv_namespaces に設定する
```

## 開発

Node.js 22 以上が必要です（Wrangler の要件）。

```sh
npm install
npm run dev        # http://localhost:5173
```

| コマンド             | 内容                                   |
| -------------------- | -------------------------------------- |
| `npm run dev`        | 開発サーバー                           |
| `npm run build`      | 本番ビルド                             |
| `npm run preview`    | ビルドしてローカルで確認               |
| `npm run deploy`     | Cloudflare Workers へデプロイ          |
| `npm run lint`       | Biome によるフォーマット検査と lint    |
| `npm run lint:fix`   | Biome の自動修正                       |
| `npm run typecheck`  | `tsc --noEmit`                         |
| `npm test`           | Vitest                                 |
| `npm run verify`     | lint → typecheck → test をまとめて実行 |
| `npm run cf-typegen` | `wrangler.jsonc` 変更後の型再生成      |

サーバーを起動した状態で `node scripts/smoke.mjs` を実行すると、HTML の配信とプロキシ API のガードを一通り確認できます。

## 構成

テストは実装ファイルと同じディレクトリに `*.test.ts(x)` として置いています。

```
src/
  index.tsx              Hono のエントリ。SSR シェルと /api のマウント
  server/
    routes.ts            プロキシ API のルーティングと入力検証
    cache.ts             Cloudflare Cache API による短時間キャッシュ
    test-utils.ts        テスト用のインメモリ KV など
    auth/
      config.ts          バインディングと OAuth 設定の解決
      oauth.ts           Backlog OAuth 2.0（認可 URL・トークン交換・更新）
      session.ts         セッションと state の KV 保存、Cookie の組み立て
      routes.ts          /api/auth/login · /callback · /session · /logout
    backlog/
      space.ts           スペースドメインの検証（オープンプロキシ化の防止）
      client.ts          Backlog API クライアント（リトライ・レート制限・トークンの masking）
      issues.ts          課題取得のオーケストレーション（クエリ組み立て・ページング・正規化）
      masters.ts         プロジェクト / 担当者 / ステータスの取得
      api-types.ts       Backlog API のレスポンス型
  shared/                クライアントとサーバーで共有するロジック
    date.ts              日付ユーティリティ
    gantt.ts             バー配置・グルーピング・目盛りの計算
    filter.ts            表示条件と URL クエリの相互変換
    types.ts             共有の型定義
  client/                React のクライアント
docs/design.md           設計ドキュメント
```

### なぜ Worker を経由するのか

ブラウザから Backlog API を直接呼ばず、必ず Cloudflare Worker を経由させています。

1. Backlog API はブラウザからのクロスオリジン呼び出しを想定していない
2. ページングと複数クエリのマージをサーバー側で完結させ、往復回数を減らせる
3. レート制限対策のキャッシュを一元管理できる

中継先のホストは `*.backlog.jp` / `*.backlog.com` / `*.backlogtool.com` に限定しています。これを怠るとアプリが任意ホストへの中継器になってしまうためです。

## 設計の詳細

背景・API 連携の設計・レート制限への対応・残っている検証項目は [`docs/design.md`](docs/design.md) にまとめています。とくに次の 2 点は Backlog API を扱ううえでの勘所です。

- **表示期間に重なる課題を漏れなく取る方法**: `startDateUntil` + `dueDateSince` で区間の重なり条件を表現し、開始日 / 期限日が片方だけの課題を拾う 2 本を足して計 3 本のクエリをマージする（§7.2）
- **完了ステータスの判定**: Backlog API のステータスには完了フラグが無いため、ID と名称によるヒューリスティックで判定する（§7.5）

## 技術構成

Hono + React 19 + Vite + Cloudflare Workers（セッション保存に Workers KV）。ガントチャートは flex 行 + 絶対配置バーで自前実装しており、外部のガントライブラリには依存していません。

lint は oxlint（type-aware ルールを有効化）、整形は oxfmt、テストは Vitest です。依存パッケージのバージョンはすべて完全固定し、Renovate で定期的に更新します。

> `oxlint --type-aware` は型情報を使う lint ルールを実行するもので、型エラー自体は検出しません。
> そのため型検査は `tsc --noEmit`（`npm run typecheck`）で別途行っています。
