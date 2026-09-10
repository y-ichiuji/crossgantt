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
- OAuth ログイン、複数スペースの横断
- 課題間の依存矢印 — Backlog に先行 / 後続という順序依存の概念がないため、原理的に描けません

## 使い方

1. Backlog の「個人設定 → API」で API キーを発行します
2. アプリを開き、スペースドメイン（例: `example.backlog.jp`）と API キーを入力します
3. プロジェクトを選ぶとガントチャートが表示されます

表示できる課題は、その API キーの持ち主が参加しているプロジェクトに限られます（Backlog 側の権限がそのまま効きます）。

### API キーの取り扱い

API キーは**このブラウザの `localStorage` にのみ保存**され、サーバーには保存されません。リクエストのたびにヘッダーで送信し、Worker はそれを Backlog へ中継するだけです。

`localStorage` は XSS が起きた場合に読み出されうる保存方式です。**共用の PC では使用しないでください。**

## 開発

Node.js 22 以上が必要です（Wrangler の要件）。

```sh
npm install
npm run dev        # http://localhost:5173
```

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー |
| `npm run build` | 本番ビルド |
| `npm run preview` | ビルドしてローカルで確認 |
| `npm run deploy` | Cloudflare Workers へデプロイ |
| `npm run lint` | Biome によるフォーマット検査と lint |
| `npm run lint:fix` | Biome の自動修正 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest |
| `npm run verify` | lint → typecheck → test をまとめて実行 |
| `npm run cf-typegen` | `wrangler.jsonc` 変更後の型再生成 |

サーバーを起動した状態で `node scripts/smoke.mjs` を実行すると、HTML の配信とプロキシ API のガードを一通り確認できます。

## 構成

```
src/
  index.tsx              Hono のエントリ。SSR シェルと /api のマウント
  server/
    routes.ts            プロキシ API のルーティングと入力検証
    cache.ts             Cloudflare Cache API による短時間キャッシュ
    backlog/
      space.ts           スペースドメインの検証（オープンプロキシ化の防止）
      client.ts          Backlog API クライアント（リトライ・レート制限・キーの masking）
      issues.ts          課題取得のオーケストレーション（クエリ組み立て・ページング・正規化）
      masters.ts         プロジェクト / 担当者 / ステータスの取得
      api-types.ts       Backlog API のレスポンス型
  shared/                クライアントとサーバーで共有するロジック
    date.ts              日付ユーティリティ
    gantt.ts             バー配置・グルーピング・目盛りの計算
    filter.ts            表示条件と URL クエリの相互変換
    types.ts             共有の型定義
  client/                React のクライアント
tests/                   Vitest のテスト
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

Hono + React 19 + Vite + Cloudflare Workers。ガントチャートは CSS Grid ではなく flex 行 + 絶対配置バーで自前実装しており、外部のガントライブラリには依存していません。
