# CrossGantt for Backlog

Backlog の**複数プロジェクト × 複数担当者**の課題を、1 枚のガントチャートで横断表示するビューアです。

Backlog 標準のガントチャートは 1 プロジェクト単位でしか表示できないため、掛け持ちしているメンバーの負荷や、プロジェクトをまたいだ期日の衝突が見えません。このアプリはそこを埋めます。

## できること

- 複数プロジェクト・複数担当者の課題を 1 つのタイムラインに描画
- **担当者別 / プロジェクト別 / マイルストーン別**のグルーピング切り替え
- 日 / 週 / 月のズーム、今日の縦線、土日の背景、日付ごとの罫線
- Backlog のガントチャートと同じく、**バーの色はステータスの色**
- 各行に**担当者のアイコン**を表示
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
pnpm exec wrangler secret put BACKLOG_CLIENT_ID
pnpm exec wrangler secret put BACKLOG_CLIENT_SECRET
```

ローカル開発では `.dev.vars.example` を `.dev.vars` にコピーして値を入れてください（`.dev.vars` は `.gitignore` 済みです）。

セッション保存用の KV 名前空間も必要です。

```sh
pnpm exec wrangler kv namespace create SESSIONS
# 出力された id を wrangler.jsonc の kv_namespaces に設定する
```

## 開発

Node.js 22 以上が必要です（Wrangler の要件）。パッケージマネージャーは pnpm で、
`package.json` の `packageManager` に完全性ハッシュ付きで固定してあります。
corepack を有効にすれば、そのバージョンが検証のうえ自動で使われます。

```sh
corepack enable
pnpm install
pnpm dev           # http://localhost:5173
```

| コマンド            | 内容                                    |
| ------------------- | --------------------------------------- |
| `pnpm dev`          | 開発サーバー                            |
| `pnpm build`        | 本番ビルド                              |
| `pnpm preview`      | ビルドしてローカルで確認                |
| `pnpm deploy`       | Cloudflare Workers へデプロイ           |
| `pnpm lint`         | oxlint（type-aware ルール込み）         |
| `pnpm lint:fix`     | oxlint の自動修正                       |
| `pnpm lint:actions` | actionlint による GitHub Actions の検査 |
| `pnpm spellcheck`   | cspell によるスペルチェック             |
| `pnpm format`       | oxfmt による整形                        |
| `pnpm format:check` | 整形されているかの確認                  |
| `pnpm typecheck`    | `tsc --noEmit`                          |
| `pnpm test`         | Vitest                                  |
| `pnpm verify`       | 上記の検証をまとめて実行                |
| `pnpm cf-typegen`   | `wrangler.jsonc` 変更後の型再生成       |

サーバーを起動した状態で `node scripts/smoke.mjs` を実行すると、HTML の配信と認証まわりのガードを一通り確認できます。

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
    App.module.css       画面全体のスタイル
    styles/
      global.css         デザイントークンとリセット（唯一のグローバル CSS）
      controls.module.css  ボタンなど共通部品（composes で取り込む）
    components/
      *.tsx              コンポーネント
      *.module.css       そのコンポーネント専用のスタイル
docs/design.md           設計ドキュメント
```

### スタイルの書き方

スタイルは **CSS Modules** でコンポーネントごとに分けています。

- グローバルなのは `src/client/styles/global.css` だけ（デザイントークンとリセット）
- 各コンポーネントは隣の `*.module.css` を `import styles from` して使う
- 共通部品は `styles/controls.module.css` に置き、`composes` で取り込む
- 状態（遅延・完了・バーの種類など）はクラス名ではなく `data-*` 属性で表し、
  CSS は `[data-overdue='true']` のように参照する。テストが見た目の実装から独立する

### なぜ Worker を経由するのか

ブラウザから Backlog API を直接呼ばず、必ず Cloudflare Worker を経由させています。

1. Backlog API はブラウザからのクロスオリジン呼び出しを想定していない
2. ページングと複数クエリのマージをサーバー側で完結させ、往復回数を減らせる
3. レート制限対策のキャッシュを一元管理できる

中継先のホストは `*.backlog.jp` / `*.backlog.com` / `*.backlogtool.com` に限定しています。これを怠るとアプリが任意ホストへの中継器になってしまうためです。

## CI / CD

GitHub Actions で次を回しています。

| ワークフロー | 契機                                | 内容                                                                                                    |
| ------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ci.yml`     | `main` への push、すべての PR       | 整形の確認 → lint → actionlint → スペルチェック → 型チェック → テスト、別ジョブでビルドとスモークテスト |
| `deploy.yml` | `main` への push                    | 検証を通してから Cloudflare Workers へデプロイし、公開後にスモークテスト                                |
| `codeql.yml` | `main` への push、すべての PR、毎週 | CodeQL によるコードの脆弱性スキャン                                                                     |

すべての action はタグではなくコミットハッシュで固定しています（Renovate がハッシュごと更新します）。

デプロイには次のリポジトリシークレットが必要です。

| シークレット            | 取得元                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare ダッシュボード → My Profile → API Tokens → 「Edit Cloudflare Workers」テンプレート |
| `CLOUDFLARE_ACCOUNT_ID` | `pnpm exec wrangler whoami` で確認できる Account ID                                           |

### ブランチ運用

GitHub Flow に沿っています。

- `main` が唯一の長命ブランチで、常にデプロイ可能な状態を保つ
- 変更は短命なトピックブランチを切って行い、Pull Request で `main` へマージする
- PR では CI（整形・lint・スペルチェック・型チェック・テスト・ビルド）が必ず回る
- `main` にマージされると自動でデプロイされる

### 依存関係の更新

[Renovate](https://docs.renovatebot.com/) が `main` に対して PR を作ります（設定は `renovate.json`）。

- 毎週月曜の未明にまとめて更新
- **脆弱性が見つかった場合は待機期間なしで即座に PR を作成**（`security` ラベル付き）。
  GitHub のアラートに加えて OSV データベースも参照する
- devDependencies のパッチ・マイナーと GitHub Actions は CI が通れば自動マージ
- 本番依存とメジャー更新は必ず人が確認する
- GitHub Actions はコミットハッシュで固定したまま更新する

### 脆弱性の検出範囲

| 対象                               | 仕組み                                                        |
| ---------------------------------- | ------------------------------------------------------------- |
| 依存パッケージの既知の脆弱性       | Renovate（GitHub アラート + OSV）                             |
| 自分たちが書いたコードの脆弱性     | CodeQL（`codeql.yml`、結果は Security タブへ）                |
| コミットに混入した秘密情報         | GitHub の Secret scanning と push protection                  |
| GitHub Actions の記述ミス          | actionlint（CI と `pnpm lint:actions`）                       |
| 公開直後の版を掴むリスク           | pnpm の `minimumReleaseAge`（24 時間、`pnpm-workspace.yaml`） |
| パッケージマネージャー自体の改ざん | `packageManager` の sha512 ハッシュを corepack が検証         |

## 設計の詳細

背景・API 連携の設計・レート制限への対応・残っている検証項目は [`docs/design.md`](docs/design.md) にまとめています。とくに次の 2 点は Backlog API を扱ううえでの勘所です。

- **表示期間に重なる課題を漏れなく取る方法**: `startDateUntil` + `dueDateSince` で区間の重なり条件を表現し、開始日 / 期限日が片方だけの課題を拾う 2 本を足して計 3 本のクエリをマージする（§7.2）
- **完了ステータスの判定**: Backlog API のステータスには完了フラグが無いため、ID と名称によるヒューリスティックで判定する（§7.5）

## 技術構成

Hono + React 19 + Vite + Cloudflare Workers（セッション保存に Workers KV）。ガントチャートは flex 行 + 絶対配置バーで自前実装しており、外部のガントライブラリには依存していません。

lint は oxlint（type-aware ルールを有効化）、整形は oxfmt、テストは Vitest です。依存パッケージのバージョンはすべて完全固定し、Renovate で定期的に更新します。

> `oxlint --type-aware` は型情報を使う lint ルールを実行するもので、型エラー自体は検出しません。
> そのため型検査は `tsc --noEmit`（`pnpm typecheck`）で別途行っています。
