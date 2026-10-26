import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const source = resolve(root, 'player/dist')
const target = resolve(root, 'dist')

if (!existsSync(source)) {
  console.error('[build] player/dist not found; run "pnpm --dir player build" first')
  process.exit(1)
}

rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
cpSync(source, target, { recursive: true })

for (const file of ['favicon.png', 'favicon.svg']) {
  const candidate = resolve(root, file)
  if (existsSync(candidate)) cpSync(candidate, resolve(target, file))
}

console.log(`[build] copied ${source} -> ${target}`)
