// エージェント用スキルを skills CLI で取得する（npm run setup:skills）。
// リポジトリにはスキルファイルを同梱しない方針。
import { execSync } from 'node:child_process'

const agents = ['claude-code', 'cursor', 'github-copilot', 'gemini-cli', 'codex']
const agentFlags = agents.map((a) => `-a ${a}`).join(' ')

const commands = [
  `npx -y skills add . -s findy-hackathon --copy ${agentFlags} -y`,
  `npx -y skills add yusukebe/hono-skill --copy ${agentFlags} -y`,
  `npx -y skills add cloudflare/skills -s cloudflare -s wrangler -s workers-best-practices -s agents-sdk -s durable-objects --copy ${agentFlags} -y`
]

let failed = false
for (const cmd of commands) {
  console.log(`> ${cmd}`)
  try {
    execSync(cmd, { stdio: 'inherit' })
  } catch {
    failed = true
  }
}

if (failed) {
  // ネットワーク等で失敗しても npm install 自体は成功させ、後から再実行できるようにする
  console.warn('\nスキルの取得に一部失敗しました。あとで `npm run setup:skills` で再実行できます。')
}
