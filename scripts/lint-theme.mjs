#!/usr/bin/env node
/**
 * theme-lint: 阻止新增绕过主题令牌的硬编码白色。
 *
 * 现有代码中的历史白色用法记录在 scripts/theme-lint-baseline.json。
 * 如果新增、复制或扩大了硬编码白色用法，计数会超过基线并导致 CI 失败。
 * 确认某个新增用法只能位于始终深色的媒体/弹层表面时，再执行：
 *   pnpm lint:theme --update-baseline
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_DIR = join(ROOT, 'player', 'src')
const BASELINE_PATH = join(ROOT, 'scripts', 'theme-lint-baseline.json')
const SOURCE_EXTENSIONS = new Set(['.vue', '.css', '.scss', '.ts', '.js', '.json'])

const WHITE_PATTERNS = [
  {
    kind: 'tailwind-white',
    pattern:
      /(?<![\w-])(?:[a-z-]+:)*(?:text|bg|border|ring|fill|stroke|from|via|to|placeholder|divide|outline|decoration|caret|accent|shadow)-white(?:\/[^\s"'`<>]+)?/gi,
  },
  {
    kind: 'hex-white',
    pattern: /#[fF]{3,6}(?![0-9a-fA-F])/g,
    normalize: match => match.toLowerCase(),
  },
  {
    kind: 'rgb-white',
    pattern: /rgba?\(\s*255\s*[, ]\s*255\s*[, ]\s*255(?:[^)]*)\)/gi,
    normalize: () => 'rgb(255,255,255)',
  },
  {
    kind: 'css-white',
    pattern:
      /\b(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?-color|fill|stroke)\s*:\s*white\b/gi,
    normalize: match => match.replace(/\s+/g, ' ').toLowerCase(),
  },
]

function walk(directory) {
  const files = []
  for (const name of readdirSync(directory)) {
    const absolute = join(directory, name)
    const stats = statSync(absolute)
    if (stats.isDirectory()) {
      files.push(...walk(absolute))
      continue
    }
    if (SOURCE_EXTENSIONS.has(extname(name))) {
      files.push(absolute)
    }
  }
  return files
}

function collectInventory() {
  const inventory = new Map()
  for (const absolute of walk(SRC_DIR)) {
    const relativePath = relative(ROOT, absolute).replaceAll('\\', '/')
    const lines = readFileSync(absolute, 'utf8').split(/\r?\n/)
    lines.forEach((line, index) => {
      for (const { kind, pattern, normalize } of WHITE_PATTERNS) {
        for (const match of line.matchAll(pattern)) {
          const raw = normalize ? normalize(match[0]) : match[0]
          const token = `${kind}:${raw}`
          let fileEntry = inventory.get(relativePath)
          if (!fileEntry) {
            fileEntry = {
              tokens: new Map(),
              occurrences: [],
            }
            inventory.set(relativePath, fileEntry)
          }
          fileEntry.tokens.set(token, (fileEntry.tokens.get(token) ?? 0) + 1)
          fileEntry.occurrences.push({ line: index + 1, token, text: line.trim() })
        }
      }
    })
  }
  return inventory
}

function toBaseline(inventory) {
  const files = {}
  for (const [file, entry] of [...inventory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    files[file] = Object.fromEntries([...entry.tokens.entries()].sort(([a], [b]) => a.localeCompare(b)))
  }
  return {
    version: 1,
    description:
      'Existing hardcoded white values. Run `pnpm lint:theme --update-baseline` only after confirming a new usage is on an always-dark surface.',
    files,
  }
}

function loadBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  } catch {
    return { version: 1, files: {} }
  }
}

const inventory = collectInventory()
const updateBaseline = process.argv.includes('--update-baseline')

if (updateBaseline) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(toBaseline(inventory), null, 2)}\n`)
  console.log(`✓ theme baseline updated: ${relative(ROOT, BASELINE_PATH)}`)
  process.exit(0)
}

const baseline = loadBaseline()
const unexpected = []
const stale = []
let totalCurrent = 0

for (const [file, entry] of inventory) {
  const allowedTokens = baseline.files?.[file] ?? {}
  for (const [token, count] of entry.tokens) {
    totalCurrent += count
    const allowed = allowedTokens[token] ?? 0
    if (count > allowed) {
      const overflow = entry.occurrences.filter(occurrence => occurrence.token === token).slice(allowed)
      unexpected.push({ file, token, count: count - allowed, occurrences: overflow })
    } else if (count < allowed) {
      stale.push({ file, token, allowed: allowed - count })
    }
  }
  for (const [token, allowed] of Object.entries(allowedTokens)) {
    if (!entry.tokens.has(token)) {
      stale.push({ file, token, allowed })
    }
  }
}

if (unexpected.length > 0) {
  const count = unexpected.reduce((sum, item) => sum + item.count, 0)
  console.error(`✖ lint:theme found ${count} new hardcoded white value(s).`)
  console.error('  使用主题令牌（text-primary、border-glass、--glass-*）代替。')
  for (const item of unexpected) {
    for (const occurrence of item.occurrences.slice(0, 10)) {
      console.error(`  ${item.file}:${occurrence.line}  ${occurrence.token}`)
    }
    if (item.occurrences.length > 10) {
      console.error(`  ${item.file}: …另有 ${item.occurrences.length - 10} 处`)
    }
  }
  process.exit(1)
}

const staleCount = stale.reduce((sum, item) => sum + item.allowed, 0)
console.log(
  `✓ lint:theme passed: ${totalCurrent} existing hardcoded white occurrence(s) are covered by the baseline.`,
)
if (staleCount > 0) {
  console.log(
    `  Baseline has ${staleCount} stale allowance(s). Run \`pnpm lint:theme --update-baseline\` to tighten it.`,
  )
}
