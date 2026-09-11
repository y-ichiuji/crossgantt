/**
 * Claude Code の PostToolUse フックから呼ばれ、編集されたファイルを整形して lint する。
 *
 * 標準入力でフックのイベント JSON を受け取り、`tool_input.file_path` を取り出す。
 * 整形は常に適用し、lint エラーが残っている場合は exit 2 で Claude に差し戻す。
 * 実行するコマンドは `pnpm run verify` と揃えてあり、フックを通ったファイルは
 * CI でも同じ検査を通る。
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

/** oxfmt が整形できる拡張子。ここに無いものは整形せず lint だけ行う。 */
const FORMAT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.yml',
  '.yaml',
  '.css',
  '.md'
]

/** スペルチェックしても意味がなく、cspell も読めないファイル。 */
const BINARY_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.pdf',
  '.zip',
  '.gz'
]

const GITHUB_WORKFLOW_DIR = '.github/workflows'

/**
 * 上から順に評価し、`appliesTo` が真になるものを全て実行する。
 *
 * 1 ファイルに複数の lint が当たることがある（例: ワークフローの YAML は
 * actionlint と cspell の両方）。`command` は node_modules/.bin のコマンド名、
 * `script` はこのリポジトリのスクリプトを指す。
 */
const LINTERS = [
  {
    appliesTo: (file) => hasExtension(file, ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']),
    command: 'oxlint',
    args: (file) => ['--type-aware', file]
  },
  {
    appliesTo: (file) => hasExtension(file, ['.css']),
    command: 'stylelint',
    args: (file) => [file]
  },
  {
    appliesTo: (file) => hasExtension(file, ['.md']),
    command: 'markdownlint-cli2',
    args: (file) => [file]
  },
  {
    // actionlint はファイル単位の引数を取らず、ワークフロー全体をまとめて検査する。
    appliesTo: (file) => isGithubWorkflow(file) && hasExtension(file, ['.yml', '.yaml']),
    script: 'scripts/actionlint.mjs',
    args: () => []
  },
  {
    // スペルチェックはファイルの種類を問わず全てに当てる。
    appliesTo: (file) => !hasExtension(file, BINARY_EXTENSIONS),
    command: 'cspell',
    args: (file) => ['--no-progress', '--no-summary', '--show-suggestions', '--dot', file]
  }
]

/** 拡張子が候補のいずれかと一致するか。 */
function hasExtension(file, extensions) {
  return extensions.includes(path.extname(file).toLowerCase())
}

/** GitHub Actions のワークフローとして置かれているか。 */
function isGithubWorkflow(file) {
  return path.dirname(file).split(path.sep).join('/') === GITHUB_WORKFLOW_DIR
}

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

/** このリポジトリの Node スクリプトを同期実行する。 */
function runScript(script, args, cwd) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' })
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

if (!existsSync(filePath)) {
  process.exit(0)
}

if (hasExtension(relative, FORMAT_EXTENSIONS)) {
  run('oxfmt', [relative], projectDir)
}

const failures = []
for (const linter of LINTERS) {
  if (!linter.appliesTo(relative)) {
    continue
  }

  const args = linter.args(relative)
  const label = linter.command ?? linter.script
  const result = linter.command ? run(linter.command, args, projectDir) : runScript(linter.script, args, projectDir)

  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    failures.push(`${label} が ${relative} で問題を報告しました。修正してください。\n\n${output}`)
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n\n')}\n`)
  process.exit(2)
}
