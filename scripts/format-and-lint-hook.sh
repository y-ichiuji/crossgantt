#!/usr/bin/env bash
# Claude Code の PostToolUse フックから呼ばれ、編集されたファイルを整形して lint する。
#
# 標準入力でフックのイベント JSON を受け取り、`tool_input.file_path` を取り出す。
# 整形は常に適用し、lint エラーが残っている場合は exit 2 で Claude に差し戻す。
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

payload=$(cat)
file_path=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')

# 対象外のファイルなら何もしない。
case "$file_path" in
  *.ts | *.tsx | *.mts | *.cts | *.js | *.mjs | *.cjs | *.json | *.jsonc) ;;
  *) exit 0 ;;
esac

# プロジェクト外のファイル（一時ディレクトリなど）は対象外。
case "$file_path" in
  "$PWD"/*) ;;
  *) exit 0 ;;
esac

[ -f "$file_path" ] || exit 0

npx --no-install oxfmt "$file_path" >/dev/null 2>&1

lint_output=$(npx --no-install oxlint --type-aware "$file_path" 2>&1)
lint_status=$?

if [ "$lint_status" -ne 0 ]; then
  printf 'oxlint が %s で問題を報告しました。修正してください。\n\n%s\n' "$file_path" "$lint_output" >&2
  exit 2
fi

exit 0
