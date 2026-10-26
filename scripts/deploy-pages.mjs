import { spawnSync } from 'node:child_process'

const project = process.env.CF_PAGES_PROJECT || 'cfsolara'
const branch = process.env.CF_PAGES_BRANCH || 'main'
const wranglerBin = process.env.WRANGLER_BIN || 'npx'
const wranglerArgs = wranglerBin === 'npx'
  ? ['wrangler', 'pages', 'deploy', 'dist', '--project-name', project, '--branch', branch, '--commit-dirty=true']
  : ['pages', 'deploy', 'dist', '--project-name', project, '--branch', branch, '--commit-dirty=true']

const result = spawnSync(wranglerBin, wranglerArgs, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error) {
  console.error(`[deploy] failed to start ${wranglerBin}: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
