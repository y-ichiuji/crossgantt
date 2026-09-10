/**
 * GitHub Actions のワークフローを actionlint で検査する。
 *
 * npm の `actionlint` パッケージは CLI ではなく WASM ライブラリなので、
 * ここで薄いラッパーを用意している。バイナリを都度ダウンロードする方式と違い、
 * pnpm-lock.yaml でバージョンが固定される利点がある。
 *
 * 使い方: node scripts/actionlint.mjs
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { createLinter } from 'actionlint'

const WORKFLOW_DIR = '.github/workflows'

const files = (await readdir(WORKFLOW_DIR)).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml')).toSorted()

if (files.length === 0) {
  console.log('検査対象のワークフローがありません')
  process.exit(0)
}

const lint = await createLinter()

let total = 0
for (const name of files) {
  const filePath = path.join(WORKFLOW_DIR, name)
  const source = await readFile(filePath, 'utf8')
  const results = lint(source, filePath)

  for (const result of results) {
    total += 1
    console.error(`${filePath}:${result.line}:${result.column}: ${result.message} [${result.kind}]`)
  }
}

if (total > 0) {
  console.error(`\nactionlint: ${total} 件の問題が見つかりました（${files.length} ファイル）`)
  process.exit(1)
}

console.log(`actionlint: 問題なし（${files.length} ファイル）`)
