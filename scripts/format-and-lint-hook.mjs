/**
 * Claude Code の PostToolUse フックから呼ばれ、編集されたファイルを整形して lint する。
 *
 * 標準入力でフックのイベント JSON を受け取り、`tool_input.file_path` を取り出す。
 * 整形は常に適用し、lint エラーが残っている場合は exit 2 で Claude に差し戻す。
 *
 * シェルスクリプトではなく Node で書いているのは、このリポジトリの全ファイルを
 * oxfmt / oxlint の対象に収めるため。`.sh` を 1 つ残すと、そのためだけに
 * shellcheck（インストール時にバイナリを取得する）を足すことになる。
 *
 * 使い方: node scripts/format-and-lint-hook.mjs < event.json
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

/** 拡張子ごとに、整形と lint をどのコマンドで行うか。 */
const HANDLERS = [
  {
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'],
    format: (file) => ['oxfmt', [file]],
    lint: (file) => ['oxlint', ['--type-aware', file]]
  },
  {
    extensions: ['.json', '.jsonc', '.yml', '.yaml'],
    format: (file) => ['oxfmt', [file]],
    lint: null
  },
  {
    extensions: ['.css'],
    format: (file) => ['oxfmt', [file]],
    lint: (file) => ['stylelint', [file]]
  },
  {
    extensions: ['.md'],
    format: (file) => ['oxfmt', [file]],
    lint: (file) => ['markdownlint-cli2', [file]]
  }
]

/** 標準入力を最後まで読む。 */
async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** node_modules/.bin のコマンドを同期実行する。 */
function run(command, args, cwd) {
  return spawnSync(path.join(cwd, 'node_modules', '.bin', command), args, {
    cwd,
    encoding: 'utf8'
  })
}

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()

let filePath
try {
  const payload = JSON.parse(await readStdin())
  filePath = payload?.tool_input?.file_path
} catch {
  // フックのイベントが読めなくても、編集自体を止める理由にはならない。
  process.exit(0)
}

if (typeof filePath !== 'string' || filePath === '') {
  process.exit(0)
}

// プロジェクト外のファイル（一時ディレクトリなど）は対象外。
const relative = path.relative(projectDir, filePath)
if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
  process.exit(0)
}

const handler = HANDLERS.find((entry) => entry.extensions.includes(path.extname(filePath)))
if (!handler || !existsSync(filePath)) {
  process.exit(0)
}

const [formatCommand, formatArgs] = handler.format(relative)
run(formatCommand, formatArgs, projectDir)

if (!handler.lint) {
  process.exit(0)
}

const [lintCommand, lintArgs] = handler.lint(relative)
const lint = run(lintCommand, lintArgs, projectDir)

if (lint.status !== 0) {
  const output = `${lint.stdout ?? ''}${lint.stderr ?? ''}`.trim()
  process.stderr.write(`${lintCommand} が ${relative} で問題を報告しました。修正してください。\n\n${output}\n`)
  process.exit(2)
}
