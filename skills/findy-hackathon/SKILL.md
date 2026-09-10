---
name: findy-hackathon
description: >-
  Findy Campus Hackathon #2「Cloudflareで好きなAIアプリを作って公開！」のキックオフ・伴走スキル。
  参加者がAIアプリを作り始めるとき、作れるものの幅（Cloudflareを使うか / AIを使うか / デプロイするか）を
  押し付けずに示し、スターターの degit からスキル導入・実装・公開まで、最適な既存スキルを案内して伴走する。
  ハッカソンを始める・プロジェクトを立ち上げる・Cloudflareにデプロイする・詰まったとき、に使う。
metadata:
  type: project
---

# Findy Campus Hackathon #2 伴走スキル

このスキルは Findy Campus Hackathon #2「Cloudflareで好きなAIアプリを作って公開！」の参加者を、アイデアからデプロイ（公開）まで伴走するためのものです。

あなた（コーディングエージェント）の役割は、参加者に選択肢を押し付けず、本人の作りたいものとスキルレベルに合わせて道筋を作ること。下の「選択肢」はあくまで地図で、最初にガッチリ決めさせるためのものではない。やりたいことから動き出し、必要なときだけ交通整理する。

---

## 0. 前提（参加者の環境）

最低限これだけあれば始められる。

- Node.js (v20+) — `npx` / `npm` が使えること。まずこれ。
- コーディングエージェント — Claude Code / Cursor / GitHub Copilot / Gemini CLI など（無料で使えるものもある）。

デプロイ（公開）する場合に追加で必要：

- Cloudflareアカウント — 無料枠でOK。Workers AI も無料枠がある。
- 認証は `npx wrangler login`（Wrangler のグローバルインストールは不要。スターターに同梱されており `npx wrangler ...` で動く）。

> Git は必須ではない（スターター取得の `npx degit` も `npx skills add` も tarball ダウンロードで git 不要）。成果物をバージョン管理・push したいときにあると便利。
>
> 環境チェックをしたいとき：`node -v`（v20+ か）、`npx wrangler whoami`（ログイン済みか）。

---

## 1. 作れるものの幅（選択肢）

作れる範囲は広く、どれも正解。最初にガッチリ決めなくていいし、途中で変えてもいい。迷うなら一番小さく作り始めて、走りながら決めればよい。

最初に意識するのは、ほぼこれだけ：

- Cloudflare を使う / 使わない — 使うかどうかでスターターが変わる（使うとローカル開発も公開も容易）。

次の2つは後から決めても・足してもいい。先に悩まなくてよい：

- AI を使う / 使わない — 使うなら Workers AI が手軽（キー不要）。凝るなら Agents SDK でエージェント（入力は基本チャット）。AIなしのふつうのWebアプリでもよい（→ 4章）。
- デプロイする / ローカルだけ — テーマは「公開」なので、動いたら一度デプロイできると良い。見せたくなければローカルだけでも（→ 5章）。

参加者にこの軸を押し付けない。やりたいことを先に聞き、必要なときだけ交通整理に使う。作り方は下の「2. 始め方」と「3. やりたい形」を参照する。

---

## 2. 始め方（Cloudflareを使う場合）

自分でディレクトリを作って一から組むより、全部入りスターターを degit するのが速い。AIを使わないふつうのWebアプリでも、これで始めてよい（Agents SDK の依存が入っていても害はない）。

1. スターターを取得して動かす（Hono + Vite + React + Agents SDK の全部入り）

   ```sh
   npx degit yusukebe/findy-campus-hackathon-02 my-hackathon-app
   cd my-hackathon-app && npm install
   npm run dev
   ```

2. スキル一式は `npm run setup:skills` で入れる（`.agents/skills/` と `.claude/skills/` にインストールされる）。
   このスキル（findy-hackathon）のほか、`hono` / `cloudflare` / `wrangler` / `workers-best-practices` /
   `agents-sdk` / `durable-objects` が導入される。このスキルが読めているなら導入済みなので案内は不要。
   入れ直したいときも同じコマンドでよい。

3. あとは作りたいものに合わせて「3. やりたい形」を参照しながら進める。デプロイ前に `wrangler.jsonc` の
   `name` を自分のアプリ名に変えるよう促す（公開URLの名前になる）。

> 追加のスキルが必要になったら `npx skills add` で後から足せる
> （例: `npx skills add cloudflare/skills --skill sandbox-sdk`）。
> `--list` でリポジトリ内のスキル一覧を確認できる。

Cloudflareを使わない場合は好きな環境でOK。ただしテーマは「公開」なので、最後に公開手段を一緒に考える。Honoを使うなら同梱スキル（`hono` / `cloudflare`）がそのまま役立つ。

---

## 3. やりたい形（参考レシピ）

下は「選ばせる」ためではなく、やりたい形が見えたときの参考。混ぜても、後から変えてもいい。

### Webアプリ

データベースを持ち、リクエストに応じてレスポンス（HTMLページや JSON）を返す、ふつうのWebアプリ。
基本構成は 画面（`src/client`）+ API + データ保存（D1 など）。AIは必須ではない。
要約・校正・翻訳・画像生成・チャットなどを足したくなったら「4. AIをどう組み込むか」へ。

### AIエージェント

Cloudflare Agents SDK を活かす。入力チャンネルは基本はチャットだが、ユーザーの希望により、他もあり。作り込みの詳細は `agents-sdk` スキルにあるので必ず読む。活かしたい主な機能：

- チャット — ストリーミングのチャットUI（`AIChatAgent` / `useAgentChat` など）。エージェントの基本の入口。
- 状態同期 — `setState` / `useAgent` でサーバ⇄ブラウザをリアルタイム同期。
- スケジュール — `this.schedule()` で時間差・定期実行（リマインド、定期バッチなど）。
- ツール呼び出し — 外部API・DB操作などをAIに実行させる。
- 永続化 — Agent 内蔵のストレージ／SQL。
- 必要に応じて MCP・human-in-the-loop・Workflows なども。

お手本（最小実例）: `yusukebe/memo2task` —「メモを書くとAIがタスク化し、時間が来たら通知」。Workers AIでの解釈 / `setState` / `this.schedule()` の3機能で成立。形を掴むのに最適。参考: `yusukebe/agents-examples`。

### プラスα: Cloudflareのプロダクトを活かす

アプリに厚みが出るし、テーマにも合う。使いやすいものから足してみる（詳細は `cloudflare` / `agents-sdk` スキルに）。

- Workers AI — 推論（テキスト/画像生成など）。キー不要で手軽。
- D1 — SQLite ベースのDB。データを保存する系のアプリに。
- R2 — オブジェクトストレージ（画像・ファイル）。アップロード系に。
- Durable Objects / Agents SDK — 状態・リアルタイム・調整。チャットやエージェントの中核。
- Browser Run — Workersからブラウザ操作（スクショ・スクレイピング・PDF化など）。
- ほかに KV（簡易キーバリュー）、Queues、Vectorize（ベクタ検索）など。

---

## 4. AIをどう組み込むか

大きく2通り。ハッカソンでは Workers AI が手軽（APIキー不要・Cloudflareに同梱・無料枠あり）。

### (a) Workers AI を使う（推奨・キー不要）

`wrangler.jsonc` に AI バインディングを追加し、`env.AI.run(...)` で呼ぶ。

```jsonc
// wrangler.jsonc
{
  "ai": { "binding": "AI" }
}
```

```ts
const res = await env.AI.run('@cf/meta/llama-3.2-3b-instruct', {
  messages: [{ role: 'user', content: 'こんにちは' }]
})
```

モデルIDは陳腐化するので、使う前に一覧で確認 → <https://developers.cloudflare.com/workers-ai/models/>。

### (b) 外部のLLM API を使う（Claude など）

より賢いモデルを使いたいときは外部APIを叩く。APIキーはコードに直書きせず secret に入れる。

```sh
npx wrangler secret put ANTHROPIC_API_KEY   # デプロイ環境用
# ローカルは .dev.vars に ANTHROPIC_API_KEY=... を書く（.gitignore 済みであること）
```

AI SDK 経由なら `@ai-sdk/anthropic` などのプロバイダを使う。利用可能な最新モデルやAPIの詳細は、
迷ったら `claude-api` スキル（このエージェントが持っていれば）や公式ドキュメントで確認する。

---

## 5. デプロイ（公開）

公開したい場合、完成を待たず、動いたら一度デプロイしておく。

```sh
npx wrangler login      # 初回のみ
npm run deploy          # = wrangler deploy。完了するとURLが出る
```

- 公開URLが出たらブラウザで開いて動作確認 → そのURLが提出/デモに使える。
- `wrangler.jsonc` を編集したら `npm run cf-typegen` で型を再生成。
- secret はデプロイ環境では `wrangler secret put`、ローカルは `.dev.vars`。`.env` / `.dev.vars` はコミットしない。

---

## 6. コスト・トークン・後片付けの注意

ハッカソン中・後で事故らないために、最初から気をつける。

- 使い終わったら消す — 試作で作った Worker や不要なリソース（D1 / R2 / KV / Durable Objects など）は削除する。
  Worker は `npx wrangler delete`。放置はコストと混乱のもと。ハッカソン後に一度棚卸しする。
  ダッシュボードからも確認ができる。
- シークレットを漏らさない — APIキーはコードに直書き・コミットしない。`.dev.vars`（ローカル）/ `npx wrangler secret put`（本番）を使い、
  `.env` / `.dev.vars` が `.gitignore` 済みか確認。ハッカソン後はキーを失効/ローテートする。
- トークン使用量に注意 — 外部LLM APIは使った分だけコスト・上限がかかる。無駄に大きいモデルや大量リクエストを避け、
  開発中は小さい入力で試す。Workers AI も無料枠の範囲を意識する。

---

## 7. 進め方のコツ（短時間で完成させる）

- まず一番小さく動くものを作る（メッセージを1往復するだけ等）。早めにデプロイして、そこから足す。
- アイデアに迷ったら、要約・校正・翻訳・分類・チャット・画像生成・「メモ→○○」など、入力→AI→出力 の単機能から考える。
- エージェントに丸投げしすぎない。動かして確認しながら小さく進める（`npm run dev`、`npx hono request` でのエンドポイント確認など）。
- 詰まったら、該当する既存スキル（`cloudflare` / `agents-sdk` / `hono`）の内容を読み直す。
- 困ったら詳しい人に聞く。

---

## 参照リンク

- ハッカソン: <https://www.craftstadium.com/hackathon/findy-campus-hackathon-202608>
- スターター（このリポジトリ・全部入り）: <https://github.com/yusukebe/findy-campus-hackathon-02>（ベース: <https://github.com/yusukebe/hono-agents-starter>）
- 最小エージェント例: <https://github.com/yusukebe/memo2task> / 実装例集: <https://github.com/yusukebe/agents-examples>
- Cloudflare 公式スキル: <https://github.com/cloudflare/skills>
- Hono スキル: <https://github.com/yusukebe/hono-skill> / yusukebe の skills カタログ: <https://github.com/yusukebe/skills>（<https://skills.yusuke.run>）
- Cloudflare Workers ドキュメント: <https://developers.cloudflare.com/workers/>
