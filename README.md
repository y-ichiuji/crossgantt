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
- 表示条件を「URL をコピー」でウェブアプリの URL に載せ、そのままチームへリンク共有できる
- 表示条件はブラウザ（IndexedDB）に覚えておき、次に開いたときも同じ条件で始められる
- ライト / ダークテーマの自動切り替え

### やらないこと

- ガント上での編集（読み取り専用です。Backlog を更新する API は一切呼びません）
- 複数スペースの横断（1 セッションにつき 1 スペース）
- 課題間の依存矢印 — Backlog に先行 / 後続という順序依存の概念がないため、原理的に描けません

## 使い方

1. アプリを開き、Backlog のスペースドメイン（例: `example.backlog.jp`）を入力します
2. 「Backlog でログイン」を押すと Backlog の認可画面に移動するので、許可します
3. アプリに戻ったらプロジェクトを選ぶとガントチャートが表示されます

プロジェクトと担当者は未選択の状態で始まります。選んだ表示条件はブラウザに残るため、2 回目以降は前回と同じ条件で開きます（共有された URL で開いたときは、その URL の条件が優先されます）。

表示できる課題は、ログインしたユーザーが参加しているプロジェクトに限られます（Backlog 側の権限がそのまま効きます）。

### 認証の仕組み

Google アカウントでのログイン（Apps Script の Web アプリ）と、Backlog の **OAuth 2.0** の
2 段構えです。

- Web アプリは「アクセスしているユーザーとして実行」で公開します。誰が使っているかは
  Google のログインで決まるため、独自のセッション ID を発行する必要がありません
- Backlog のアクセストークンとリフレッシュトークンは、その Google アカウント専用の領域
  （`PropertiesService.getUserProperties()`）にのみ保存され、ブラウザには渡りません
- アクセストークンは有効期限が近づくとサーバー側で自動的に更新されます。更新は
  `LockService` で直列化し、リフレッシュトークンのローテーションと競合しないようにしています
- CSRF 対策として、認可リクエストの `state` にサーバーが払い出した使い捨ての値（nonce）を
  載せ、コールバックで照合して消費します
- `state` には「どのスペースへ認可を求めたか」も載せます。この値はクライアント由来なので、
  受け取ったあとに必ず許可ドメインの検証を通し直します

## セットアップ（セルフホストする場合）

### 1. Apps Script プロジェクトを作る

```sh
pnpm install
pnpm exec clasp login
pnpm exec clasp create-script --title CrossGantt --type webapp --rootDir gas-dist
```

生成された `.clasp.json` の `rootDir` が `gas-dist` になっていることを確認してください
（`.clasp.json` は `.gitignore` 済みです。手で作る場合は `.clasp.json.example` を使ってください）。

### 2. いちど公開して URL を確定させる

Backlog に登録するリダイレクト URI には、この Web アプリの `/exec` URL を使います。
先にデプロイして URL を確定させます。

```sh
GAS_ALLOW_NEW_DEPLOYMENT=1 pnpm run deploy
pnpm exec clasp list-deployments
```

`@HEAD` ではないほう（説明が付いているもの）のデプロイ ID を控えてください。
`@HEAD` は Apps Script が自動で持っている開発用のデプロイで、`/exec` の URL を持ちません。

**以降は同じデプロイを更新し続けます。** 新しいデプロイを作ると URL が変わり、Backlog 側の
登録と食い違ってログインできなくなります。事故を防ぐため、2 回目以降は ID の指定が必須です。

```sh
GAS_DEPLOYMENT_ID=<控えたデプロイ ID> pnpm run deploy
```

### 3. Backlog に OAuth アプリを登録する

[Backlog Developer サイト](https://backlog.com/developer/applications/)でアプリを登録し、
リダイレクト URI に Web アプリの URL をそのまま設定します。

```text
https://script.google.com/macros/s/<デプロイ ID>/exec
```

### 4. クライアント ID とシークレットを設定する

Apps Script エディタの「プロジェクトの設定」→「スクリプト プロパティ」に次を追加します。

| プロパティ              | 必須 | 内容                                                    |
| ----------------------- | ---- | ------------------------------------------------------- |
| `BACKLOG_CLIENT_ID`     | ○    | Backlog で発行したクライアント ID                       |
| `BACKLOG_CLIENT_SECRET` | ○    | Backlog で発行したクライアントシークレット              |
| `OAUTH_REDIRECT_URI`    | ○    | 手順 3 で登録した `/exec` の URL                        |
| `WEB_APP_URL`           |      | 共有 URL の土台。未設定なら `OAUTH_REDIRECT_URI` を使う |

スクリプトプロパティはリポジトリに含まれません。コードと一緒にコミットしないでください。

Web アプリの URL は `ScriptApp.getService().getUrl()` でも取得できますが、あえて使わず
設定で受け取っています。Apps Script の**承認スコープはコードの静的解析で決まる**ため、
`ScriptApp` に触れるだけで「トリガーの管理」まで含むスコープを利用者全員に承認させることに
なり、承認しきれないと画面が出ません。この画面に本当に必要なのは外部サービスへの接続だけです。
`getUrl()` が「いま開いているデプロイ」の URL を返す（`/dev` で開くとリダイレクト URI が
食い違う）という性質もあり、設定で固定するほうが確実です。

### 5. 公開範囲を決める

`gas/appsscript.json` の `webapp.access` が公開範囲です。既定は `DOMAIN`
（同じ Google Workspace ドメインの利用者だけ）です。用途に応じて `MYSELF` や `ANYONE`
へ変えてください。`executeAs` は利用者ごとにトークンを分けるため `USER_ACCESSING` から
変えないでください。

## 開発

Node.js 22 以上が必要です。パッケージマネージャーは pnpm で、
`package.json` の `packageManager` に完全性ハッシュ付きで固定してあります。
corepack を有効にすれば、そのバージョンが検証のうえ自動で使われます。

```sh
corepack enable
pnpm install
pnpm dev           # http://localhost:5173
```

`pnpm dev` は画面の見た目を確認するためのものです。Apps Script のサービスはブラウザには
無いため、この状態では API 呼び出しとログインは動きません（サーバーが無いことを
伝えるエラーになります）。実際の動作は `pnpm run push` で反映して Web アプリ上で確認します。

| コマンド            | 内容                                                             |
| ------------------- | ---------------------------------------------------------------- |
| `pnpm dev`          | 画面だけの開発サーバー                                           |
| `pnpm build`        | `gas-dist/` を組み立てる                                         |
| `pnpm smoke`        | `gas-dist/` が push できる形かを検査                             |
| `pnpm push`         | ビルドして `clasp push`（デプロイは更新しない）                  |
| `pnpm deploy`       | ビルドして push し、デプロイを更新（`GAS_DEPLOYMENT_ID` が必要） |
| `pnpm lint`         | oxlint（type-aware ルール込み）                                  |
| `pnpm lint:fix`     | oxlint の自動修正                                                |
| `pnpm lint:css`     | stylelint による CSS の検査                                      |
| `pnpm lint:css:fix` | stylelint の自動修正                                             |
| `pnpm lint:md`      | markdownlint による Markdown の検査                              |
| `pnpm lint:md:fix`  | markdownlint の自動修正                                          |
| `pnpm lint:actions` | actionlint による GitHub Actions の検査                          |
| `pnpm spellcheck`   | cspell によるスペルチェック                                      |
| `pnpm format`       | oxfmt による整形                                                 |
| `pnpm format:check` | 整形されているかの確認                                           |
| `pnpm typecheck`    | `tsc --noEmit`                                                   |
| `pnpm test`         | Vitest                                                           |
| `pnpm verify`       | 上記の検証をビルドと `smoke` まで含めてまとめて実行              |

### ビルドの仕組み

Apps Script は ES モジュールを解釈せず、画像や JS を返す URL も持てません。
そのため成果物を次の形に組み立てます（`scripts/build-gas.mjs`）。

```text
gas-dist/
  appsscript.json   マニフェスト（gas/ からのコピー）
  Code.js           サーバー側を 1 つのグローバルへまとめた IIFE + トップレベル関数
  index.html        画面のテンプレート（gas/ からのコピー）
  app-css.html      クライアントのスタイル（<style> で包んだもの）
  app-js.html       クライアントのバンドル（Base64 にして div へ載せたもの）
```

- クライアントは vite で 1 つの JS と 1 つの CSS にまとめる
- サーバーは esbuild で ES2019 相当まで落としてまとめる。V8 ランタイムがどの
  ECMAScript 版まで含むかは公表されていないため、構文は広く通る範囲に寄せている
- 組み込みの不足（`Array.prototype.toSorted`）は `src/server/gas/polyfill.ts` で補う
- `UrlFetchApp` は **2KB を超える URL を受け付けない**。プロジェクトを選ぶほど
  `projectId[]` が並ぶため、課題取得は URL に収まる組へ分けて問い合わせ、
  結果を課題 ID でマージする。それでも収まらない場合は担当者・ステータスの
  絞り込みを Backlog へ渡すのをやめ、取得後に同じ条件で絞る（課題の応答には
  担当者 ID とステータス ID が含まれるため、結果は変わらず取得量だけが増える）
- クライアントのバンドルは **Base64 にして運ぶ**（後述）
- `pnpm smoke` は成果物を読み、Apps Script に無い機能（`fetch` / `URL` /
  `URLSearchParams` / `setTimeout` など）をサーバー側が使っていないかを検査する

### なぜバンドルを Base64 で運ぶのか

`HtmlService` は**ファイルの中身を HTML として解析する**。JavaScript には
`i<n` のような比較演算子があり、パーサはこれをタグの開始と解釈する。
`<script>` で包んでいても中身を作り替えてしまい、内容が静かに欠ける。

実際、224,247 文字のバンドルが読み出しの時点で 170,468 文字まで削られ、
React が起動せず画面が空になった。サーバー側は成功したままで、保存されている
ファイル自体も無傷なので、原因が非常に分かりにくい。

Base64 には `<` も `&` も `>` も現れないため、どう解析されても 1 文字も
変わらない。ページ側の小さな読み込み処理がこれをデコードし、`<script>`
要素として実行する。

同じ理由で、テンプレート（`gas/index.html`）に書くスクリプトでは比較演算子の
`<` を使わない（`i < n` ではなく `i !== n` と書く）。起動時の設定も
`<script type="application/json">` に載せ、JavaScript として解釈させない。
`pnpm smoke` がどちらも検査する。

## 構成

テストは実装ファイルと同じディレクトリに `*.test.ts(x)` として置いています。

```text
gas/
  appsscript.json        Web アプリのマニフェスト（公開範囲・実行者）
  index.html             HtmlService のテンプレート
src/
  server/                Apps Script 上で動く部分。すべて同期処理
    api.ts               API の本体（入力検証・キャッシュ・認証ガード）
    cache.ts             CacheService による短時間キャッシュ（100KB 超は分割）
    fetcher.ts           外部 HTTP 呼び出しの抽象（UrlFetchApp に対応）
    failure.ts           クライアントへ伝える失敗の型
    holidays.ts          日本の祝日の取得
    test-utils.ts        テスト用のインメモリ実装
    gas/                 Apps Script のグローバルに触る唯一の層
      main.ts            doGet / apiCall / include
      runtime.ts         UrlFetchApp・CacheService・PropertiesService などの接続
      html.ts            HtmlService による画面の配信
      polyfill.ts        足りない組み込みの補完
    auth/
      oauth.ts           Backlog OAuth 2.0（トークン交換・更新）
      session.ts         セッションと nonce の UserProperties 保存
      callback.ts        認可コールバックの処理
    backlog/
      client.ts          Backlog API クライアント（リトライ・レート制限・トークンの masking）
      issues.ts          課題取得のオーケストレーション（クエリ組み立て・ページング・正規化）
      masters.ts         プロジェクト / 担当者 / ステータスの取得
      api-types.ts       Backlog API のレスポンス型
  shared/                クライアントとサーバーで共有するロジック
    date.ts              日付ユーティリティ
    gantt.ts             バー配置・グルーピング・目盛りの計算
    filter.ts            表示条件と URL クエリの相互変換
    space.ts             スペースドメインの検証（オープンプロキシ化の防止）
    oauth.ts             認可 URL と state の組み立て・分解
    types.ts             共有の型定義
  client/                React のクライアント
    api.ts               google.script.run 経由のサーバー呼び出し
    bootstrap.ts         doGet が埋め込んだ設定の受け取り
    filter-store.ts      直前の表示条件の IndexedDB 保存
    storage.ts           直前に入力したスペースの localStorage 保存
    icons.ts             担当者アイコンのまとめ取得
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

### レート制限への当たりを減らす工夫

Backlog のレート制限は区分ごとに 1 分あたりの回数で効く。プロジェクトを
数十個選ぶ使い方では、素朴に実装すると簡単に使い切ってしまう。

- **マスタ情報はプロジェクト単位でキャッシュする**。担当者とステータスは
  `/projects/{id}/users` と `/projects/{id}/statuses` をプロジェクトごとに
  叩くため、選択した組を 1 つのキーにすると選択を 1 つ変えるだけで全件を
  取り直すことになる。プロジェクトごとに覚えておけば、増えたぶんだけで済む
- **保持時間を長めに取る**。マスタは 30 分、課題は 3 分。最新にしたいときは
  「再読込」がキャッシュを無視する
- **大きな応答も分割して保持する**。CacheService は 1 キー 100KB までなので、
  課題が数千件になる場合は断片に分けて書き込む

### なぜサーバーを経由するのか

ブラウザから Backlog API を直接呼ばず、必ず Apps Script 側を経由させています。

1. Backlog API はブラウザからのクロスオリジン呼び出しを想定していない
2. ページングと複数クエリのマージをサーバー側で完結させ、往復回数を減らせる
3. レート制限対策のキャッシュを一元管理できる

中継先のホストは `*.backlog.jp` / `*.backlog.com` / `*.backlogtool.com` に限定しています。これを怠るとアプリが任意ホストへの中継器になってしまうためです。

## CI / CD

GitHub Actions で次を回しています。

| ワークフロー | 契機                                      | 内容                                                                                                                       |
| ------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`     | `main` への push、すべての PR             | 整形の確認 → lint（TS / CSS / Markdown / Actions）→ スペルチェック → 型チェック → テスト、別ジョブでビルドとスモークテスト |
| `deploy.yml` | **CI と CodeQL が `main` で成功したあと** | ビルドと成果物の検査を行い、clasp で Apps Script へ push してデプロイを更新                                                |
| `codeql.yml` | `main` への push、すべての PR、毎週       | CodeQL によるコードの脆弱性スキャン                                                                                        |

すべての action はタグではなくコミットハッシュで固定しています（Renovate がハッシュごと更新します）。

`deploy.yml` は `main` への push で直接動くのではなく、**CI と CodeQL の両方が同じコミットで
成功してから**動きます（`workflow_run`）。どちらか一方が完了するたびに起動されるため、
先頭の gate ジョブで「もう片方も同じ SHA で成功しているか」を確認し、揃っていなければ
そのタイミングでは見送ります。緊急時は `workflow_dispatch` の `skip_checks` で確認を
省略できますが、実行ログに警告が残ります。

デプロイには次のリポジトリシークレットが必要です。

| シークレット        | 取得元                                                                          |
| ------------------- | ------------------------------------------------------------------------------- |
| `CLASP_CREDENTIALS` | `clasp login` 後にホームディレクトリへ作られる `.clasprc.json` の中身をそのまま |
| `GAS_SCRIPT_ID`     | `.clasp.json` の `scriptId`、または Apps Script エディタのプロジェクト設定      |
| `GAS_DEPLOYMENT_ID` | `pnpm exec clasp list-deployments` で表示される、運用中のデプロイ ID            |

`CLASP_CREDENTIALS` はリフレッシュトークンを含みます。ワークフローでは実行のたびに
書き出して、`always()` のステップで必ず消しています。

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

React 19 + Vite + Google Apps Script（Web アプリ）。サーバー側は Apps Script の
`UrlFetchApp` / `CacheService` / `PropertiesService` / `LockService` の上に組んでおり、
外部ライブラリには依存していません。ガントチャートは flex 行 + 絶対配置バーで
自前実装しており、外部のガントライブラリにも依存していません。

Apps Script には `fetch` も `Promise` を待つ手段も無いため、サーバー側は最初から
すべて同期処理として書いています。並列化は `UrlFetchApp.fetchAll` に対応する
`Fetcher`（複数リクエストをまとめて受け取る関数）へ委ねています。

整形は oxfmt に一本化しています。TypeScript / JavaScript だけでなく CSS・Markdown・JSON・YAML も
oxfmt が扱うため、整形ツールはこれ 1 つです。テストは Vitest。依存パッケージのバージョンは
すべて完全固定し、Renovate で定期的に更新します。

lint は対象ごとに使い分けています。

| 対象                    | ツール                                 |
| ----------------------- | -------------------------------------- |
| TypeScript / JavaScript | oxlint（type-aware ルールを有効化）    |
| CSS                     | stylelint（stylelint-config-standard） |
| Markdown                | markdownlint-cli2                      |
| GitHub Actions          | actionlint                             |
| 全ファイルのスペル      | cspell                                 |

oxlint は `correctness` / `suspicious` / `pedantic` をエラー、`perf` を警告として有効にし、
`typescript` / `unicorn` / `oxc` / `import` / `promise` / `react` / `jsx-a11y` / `vitest` /
`jsdoc` / `node` の各プラグインを読み込んでいます。`style` と `restriction` は
「三項演算子を禁止する」「マジックナンバーを禁止する」といった、このコードベースの書き方と
真っ向から衝突するルールが大半のため、有用なものだけを個別に有効化しています。
無効にしたルールには `.oxlintrc.json` に理由を添えています。

oxlint 本体に無い検査は、外部の ESLint プラグインを `jsPlugins` として読み込んで補っています。

| プラグイン                    | 何を見るか                                                           |
| ----------------------------- | -------------------------------------------------------------------- |
| eslint-plugin-react-hooks     | React Compiler 由来のルール（`refs`・`purity`・`immutability` など） |
| eslint-plugin-css-modules     | `styles.xxx` が CSS 側にあるか、CSS 側に使われていないクラスが無いか |
| eslint-plugin-regexp          | 正規表現の書き間違い（推奨セット 60 ルール）                         |
| eslint-plugin-no-unsanitized  | `innerHTML` などへの安全でない代入                                   |
| eslint-plugin-testing-library | Testing Library の使い方（`await` 漏れなど）                         |
| eslint-plugin-sonarjs         | バグ・セキュリティ・正規表現の実行時間・テスト品質・認知的複雑度     |

`jsPlugins` は oxlint 側で alpha 扱いかつ semver の対象外ですが、CSS Modules のクラス名の
検証のように本体では代えの利かない検査があるため、例外として採用しています。

Claude Code のフック（`scripts/format-and-lint-hook.mjs`）は、編集されたファイルの拡張子を見て
上の表と同じツールを走らせます。整形は oxfmt が扱える拡張子に対して常に適用し、lint が
問題を報告した場合は exit 2 でエージェントに差し戻します。cspell は拡張子を問わず全ファイルに、
actionlint は `.github/workflows` 配下のワークフローに当たります。`pnpm verify` で落ちる変更に
その場で気付けるようにするための仕組みです。

シェルスクリプトは意図的に置いていません。`.sh` を 1 つ残すと、そのためだけに
shellcheck（インストール時にバイナリを取得する）を足すことになるため、フックも Node で
書いています。

> `oxlint --type-aware` は型情報を使う lint ルールを実行するもので、型エラー自体は検出しません。
> そのため型検査は `tsc --noEmit`（`pnpm typecheck`）で別途行っています。
