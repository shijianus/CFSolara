#!/usr/bin/env node
/**
 * epocanvas sonic branding audit.
 *
 * Modes:
 *   --snapshot <file>  Capture the current protected-identifier and display-brand state.
 *   --compare <file>   Compare the current state against a previously captured snapshot.
 *   --verify           Verify brand constants, built metadata, and display-surface completeness.
 *
 * The protected identifiers are wire/storage contracts. They must remain byte-identical
 * during a display-only rebrand; changing them would break sessions, downloads, or API clients.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const AUDIT_FILE = 'scripts/brand-audit.mjs'

const SCAN_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.vue', '.html', '.htm',
  '.md', '.json', '.css', '.scss', '.svg', '.py', '.toml', '.example',
])

const EXCLUDE_PREFIXES = [
  '.zcode/',
  '.git/',
  '.deploy/',
  '.wrangler/',
  'node_modules/',
  'player/node_modules/',
  'dist/',
  'player/dist/',
  'screenshots/',
  'temp_',
]

const PROTECTED_PATTERNS = [
  { id: 'api-sonic-route', re: /\/api\/sonic\/[A-Za-z0-9_[\]{}./-]*/g, note: 'public API route namespace' },
  { id: 'brand-field', re: /\bbrand\s*:\s*['"]Sonic['"]/g, note: 'gateway wire brand' },
  { id: 'brand-check', re: /\bbrand\s*===\s*['"]Sonic['"]/g, note: 'client wire-brand check' },
  { id: 'sonic-live-key', re: /\bsonic_live_/g, note: 'current API key prefix' },
  { id: 'solara-live-key', re: /\bsolara_live_/g, note: 'legacy API key prefix' },
  { id: 'sonic-header', re: /\bX-Sonic-[A-Za-z]+/g, note: 'gateway request/response headers' },
  { id: 'cfsolara-header', re: /\bX-CFSolara-Key\b/g, note: 'legacy auth header' },
  { id: 'shijianus-header', re: /\bX-Shijianus-Device-Id\b/g, note: 'device auth header' },
  { id: 'sonic-env', re: /\bSONIC_[A-Z0-9_]+\b/g, note: 'environment variable namespace' },
  { id: 'solara-secret', re: /\bSOLARA_SECRET\b/g, note: 'legacy signing-secret fallback' },
  { id: 'sonic-cache-param', re: /\b_sonic_[a-z0-9_]+\b/g, note: 'cache-key query parameter' },
  { id: 'indexeddb-name', re: /\bSonicMusicPlayerDB\b/g, note: 'IndexedDB database name' },
  { id: 'legacy-session-key', re: /\bsonic_epomail_session\b/g, note: 'legacy auth session key' },
  { id: 'perf-mode-storage', re: /\bsonic-perf-mode\b/g, note: 'performance-mode storage key' },
  { id: 'platform-sonic', re: /\bplatform\s*:\s*['"]sonic['"]/g, note: 'desensitized provider id' },
  { id: 'source-sonic', re: /\bsource\s*:\s*['"]sonic['"]/g, note: 'source identifier' },
  { id: 'format-sonic', re: /\bformat\s*(?:===|==|=|:)\s*['"]sonic['"]/g, note: 'API format value' },
  { id: 'sonic-ua', re: /\bSONIC_UA\b/g, note: 'upstream User-Agent constant' },
  { id: 'sonic-cover-grad', re: /\bsonicCoverGrad\b/g, note: 'cover SVG gradient id' },
  { id: 'logo-path', re: /["']\/logo\.svg["']/g, note: 'logo asset path' },
  { id: 'cfsolara-project', re: /\bcfsolara\b/g, note: 'Cloudflare Pages project name' },
  { id: 'sonic-audio-global', re: /\b__sonicAudio\b/g, note: 'debug/global audio handle' },
  { id: 'legacy-sonic-globals', re: /\b(?:SonicDom|SonicMobileBridge)\b/g, note: 'legacy runtime globals' },
  { id: 'pinia-storage-keys', re: /piniaPersistConfig\(\s*['"](?:global|settings|audio|user)['"]|localStorage\.getItem\(\s*['"]global['"]/g, note: 'player persistence keys' },
  { id: 'quality-labels', re: /['"](?:SQ|HQ|标准)['"]/g, note: 'quality badge/filter labels' },
]

const PROTECTED_HASH_EXCEPTIONS = new Set([
  // Display-only color palette defaults (aurora/color-bends/ultimate gradients).
  'player/src/stores/modules/settings.ts',
])

const PROTECTED_FILE_PATTERNS = [
  'player/src/utils/indexedDB.ts',
  'player/src/stores/persist.ts',
  'player/src/stores/modules/',
  'player/src/composables/useLyrics.ts',
  'player/src/languages/index.ts',
  'functions/_lib/auth.ts',
  'functions/_lib/http.ts',
  'functions/_lib/types.ts',
  'functions/_lib/music.ts',
  'functions/_lib/sonic/config.ts',
  'functions/_lib/sonic/types.ts',
  'functions/_lib/sonic/route-helpers.ts',
  'functions/_lib/sonic/nexus-search.ts',
  'functions/_lib/sonic/nexus-lyrics.ts',
  'functions/_lib/sonic/index.ts',
  'functions/_lib/sonic/utils.ts',
  'functions/_lib/sonic/providers/',
  'functions/api/sonic/',
  'functions/api/[[path]].ts',
]

const DISPLAY_BRAND_CLEAN_FILES = [
  'player/index.html',
  'player/src/layout/aside.vue',
  'player/src/layout/mobile/Header.vue',
  'player/src/pages/mobile/settings.vue',
  'player/src/languages/modules/zh.ts',
  'player/src/languages/modules/en.ts',
  'player/src/languages/modules/ja.ts',
  'player/src/pages/mv-player.vue',
  'index.html',
  'js/mobile.js',
]

const DISPLAY_BRAND_ALLOWLIST = [
  'README.md',
  'API.md',
  'player/README.md',
  'player/LICENSE',
  'player/public/logo.svg',
  'player/src/config/brand.ts',
  'player/src/composables/useLyrics.ts',
  'player/src/components/Search/SearchSongs.vue',
  'player/src/components/SongList.vue',
  'player/src/layout/index.vue',
  'player/src/pages/mobile/search.vue',
  'player/src/stores/modules/audio.ts',
  'player/src/utils/imageUrl.ts',
  'player/src/utils/lyricsWordSync.ts',
  'js/index.js',
  'functions/_lib/brand.ts',
  'functions/_lib/sonic-types.ts',
  'functions/_lib/sonic-providers.ts',
  'functions/_lib/sonic/providers/',
  'functions/_lib/sonic/config.ts',
  'functions/_lib/sonic/types.ts',
  'functions/_lib/sonic/route-helpers.ts',
  'functions/_lib/sonic/nexus-search.ts',
  'functions/_lib/sonic/nexus-lyrics.ts',
  'functions/_lib/sonic/index.ts',
  'functions/_lib/sonic/utils.ts',
  'functions/_lib/sonic/upstream.ts',
  'functions/_lib/sonic/cache.ts',
  'functions/_lib/sonic/crypto.ts',
  'functions/_lib/sonic/local-engine.ts',
  'functions/_lib/sonic/native-protocols.ts',
  'functions/_lib/sonic/security.ts',
  'functions/_lib/auth.ts',
  'functions/_lib/http.ts',
  'functions/_lib/types.ts',
  'functions/_lib/music.ts',
  'functions/api/sonic/',
  'functions/api/music/',
  'functions/api/index.ts',
  'functions/api/auth/key.ts',
  'functions/api/auth/callback.ts',
  'server/index.ts',
  'reports/',
  'scripts/',
]

function normalizePath(value) {
  return value.replace(/\\/g, '/')
}

function isExcluded(relative) {
  if (relative === AUDIT_FILE) return true
  return EXCLUDE_PREFIXES.some((prefix) => relative.startsWith(prefix))
}

function hasScannableExtension(relative) {
  return SCAN_EXTENSIONS.has(path.extname(relative).toLowerCase())
}

function listRepositoryFiles() {
  const output = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return [...new Set(output.split('\0').filter(Boolean).map(normalizePath))]
    .filter((relative) => !isExcluded(relative) && hasScannableExtension(relative))
    .sort()
}

function readText(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

function lineAt(text, index) {
  const start = text.lastIndexOf('\n', index - 1) + 1
  const end = text.indexOf('\n', index)
  return text.slice(start, end === -1 ? text.length : end).trim().replace(/\s+/g, ' ')
}

function hashFile(relative) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative))).digest('hex')
}

function matchesPattern(file) {
  return PROTECTED_FILE_PATTERNS.some((pattern) =>
    pattern.endsWith('/') ? file.startsWith(pattern) : file === pattern,
  )
}

function extractClientRoutes() {
  const file = 'player/src/routers/index.ts'
  if (!fs.existsSync(path.join(ROOT, file))) return []
  return [...readText(file).matchAll(/path:\s*['"]([^'"]+)['"]/g)]
    .map(match => match[1])
    .sort()
}

function collectState() {
  const files = listRepositoryFiles()
  const protectedEntries = {}
  const displayEntries = []
  const textCache = new Map()

  for (const token of PROTECTED_PATTERNS) {
    protectedEntries[token.id] = []
  }

  for (const file of files) {
    const text = readText(file)
    textCache.set(file, text)

    // Documentation is allowed to update examples and compatibility notes; brand config files
    // only describe the frozen names. Runtime contracts are verified from code, tests, and the
    // protected-file hashes below.
    const isBrandConfig = file === 'player/src/config/brand.ts' || file === 'functions/_lib/brand.ts'
    if (!file.endsWith('.md') && !isBrandConfig) {
      for (const token of PROTECTED_PATTERNS) {
        token.re.lastIndex = 0
        let match
        while ((match = token.re.exec(text)) !== null) {
          protectedEntries[token.id].push(`${file}::${lineAt(text, match.index)}`)
          if (match[0].length === 0) token.re.lastIndex += 1
        }
      }
    }

    const displayRe = /\bSonic\b|Glass Music Player|\bEpoCanvas\b/g
    let displayMatch
    while ((displayMatch = displayRe.exec(text)) !== null) {
      displayEntries.push(`${file}::${lineAt(text, displayMatch.index)}`)
    }
  }

  for (const token of PROTECTED_PATTERNS) {
    protectedEntries[token.id].sort()
  }
  displayEntries.sort()

  const hashes = {}
  for (const file of files) {
    if (matchesPattern(file) && file !== 'functions/_lib/sonic/upstream.ts' && !PROTECTED_HASH_EXCEPTIONS.has(file)) {
      hashes[file] = hashFile(file)
    }
  }

  const routeFiles = files
    .filter((file) => file.startsWith('functions/api/sonic/') || file === 'functions/api/[[path]].ts')
    .sort()

  let head = ''
  let branch = ''
  let status = ''
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
    branch = execFileSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim()
    status = execFileSync('git', ['status', '--porcelain=v1'], { cwd: ROOT, encoding: 'utf8' })
  } catch {
    // Git metadata is informational only.
  }

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    head,
    branch,
    status,
    filesScanned: files.length,
    protectedPatterns: PROTECTED_PATTERNS.map(({ id, note }) => ({ id, note })),
    protectedEntries,
    protectedFileHashes: hashes,
    routeFiles,
    clientRoutes: extractClientRoutes(),
    displayEntries,
  }
}

function compareStates(before, after) {
  const failures = []

  const countByFile = (entries) => {
    const counts = {}
    for (const entry of entries) {
      const file = entry.slice(0, entry.indexOf('::'))
      if (file.endsWith('.md')) continue
      counts[file] = (counts[file] || 0) + 1
    }
    return counts
  }

  for (const token of before.protectedPatterns) {
    const beforeCounts = countByFile(before.protectedEntries[token.id] || [])
    const afterCounts = countByFile(after.protectedEntries[token.id] || [])
    const allFiles = [...new Set([...Object.keys(beforeCounts), ...Object.keys(afterCounts)])].sort()
    const removed = []
    const added = []
    for (const file of allFiles) {
      const delta = (afterCounts[file] || 0) - (beforeCounts[file] || 0)
      if (delta < 0) removed.push(`${file} (${-delta})`)
      if (delta > 0) added.push(`${file} (+${delta})`)
    }
    if (removed.length > 0 || added.length > 0) {
      failures.push({
        token: token.id,
        note: token.note,
        removed,
        added,
      })
    }
  }

  const beforeHashes = before.protectedFileHashes || {}
  const afterHashes = after.protectedFileHashes || {}
  const allFiles = [...new Set([...Object.keys(beforeHashes), ...Object.keys(afterHashes)])].sort()
  for (const file of allFiles) {
    if (beforeHashes[file] !== afterHashes[file]) {
      failures.push({
        token: 'protected-file-hash',
        note: `protected file changed: ${file}`,
        removed: beforeHashes[file] ? [beforeHashes[file]] : [],
        added: afterHashes[file] ? [afterHashes[file]] : [],
      })
    }
  }

  if (JSON.stringify(before.routeFiles) !== JSON.stringify(after.routeFiles)) {
    failures.push({
      token: 'route-file-list',
      note: 'API route files were added, removed, or renamed',
      removed: before.routeFiles.filter((file) => !after.routeFiles.includes(file)),
      added: after.routeFiles.filter((file) => !before.routeFiles.includes(file)),
    })
  }

  if (JSON.stringify(before.clientRoutes) !== JSON.stringify(after.clientRoutes)) {
    failures.push({
      token: 'client-route-paths',
      note: 'client route paths were added, removed, or renamed',
      removed: (before.clientRoutes || []).filter((route) => !(after.clientRoutes || []).includes(route)),
      added: (after.clientRoutes || []).filter((route) => !(before.clientRoutes || []).includes(route)),
    })
  }

  return failures
}

function readConstants(relative) {
  const text = readText(relative)
  const names = [
    'BRAND_PARENT',
    'BRAND_PRODUCT',
    'BRAND_FULL',
    'BRAND_TITLE',
    'BRAND_DESCRIPTION',
    'BRAND_KEYWORDS',
    'BRAND_COPYRIGHT',
    'BRAND_STUDIO',
    'BRAND_TAGLINE',
  ]
  const values = {}
  for (const name of names) {
    const match = text.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*['"]([^'"]+)['"]`))
    if (match) values[name] = match[1]
  }
  return values
}

function verify() {
  const failures = []
  const expected = {
    BRAND_PARENT: 'epocanvas',
    BRAND_PRODUCT: 'sonic',
    BRAND_FULL: 'epocanvas sonic',
    BRAND_TITLE: 'epocanvas sonic - Cloud Music Platform',
    BRAND_DESCRIPTION: 'epocanvas sonic Music Cloud Platform',
    BRAND_KEYWORDS: 'epocanvas, sonic, Music, Streaming, Cloud Platform',
    BRAND_COPYRIGHT: '© epocanvas',
    BRAND_STUDIO: 'STUDIO',
    BRAND_TAGLINE: 'AUDIO ENGINE',
  }

  const frontend = readConstants('player/src/config/brand.ts')
  const backend = readConstants('functions/_lib/brand.ts')
  for (const [name, value] of Object.entries(expected)) {
    if (frontend[name] !== value) failures.push(`frontend ${name}: expected "${value}", got "${frontend[name] ?? '<missing>'}"`)
    if (backend[name] !== value) failures.push(`backend ${name}: expected "${value}", got "${backend[name] ?? '<missing>'}"`)
  }

  const playerHtml = readText('player/index.html')
  if (!playerHtml.includes(`<title>${expected.BRAND_TITLE}</title>`)) {
    failures.push('player/index.html title is not the expected full brand title')
  }
  for (const value of [expected.BRAND_DESCRIPTION, expected.BRAND_KEYWORDS]) {
    if (!playerHtml.includes(value)) failures.push(`player/index.html missing metadata value: ${value}`)
  }
  for (const marker of ['og:title', 'og:description', 'og:site_name', 'twitter:card']) {
    if (!playerHtml.includes(marker)) failures.push(`player/index.html missing ${marker}`)
  }

  const aside = readText('player/src/layout/aside.vue')
  for (const name of ['BRAND_PARENT', 'BRAND_PRODUCT', 'BRAND_FULL', 'BRAND_STUDIO', 'BRAND_TAGLINE']) {
    if (!aside.includes(name)) failures.push(`aside.vue does not use ${name}`)
  }

  const mobileHeader = readText('player/src/layout/mobile/Header.vue')
  for (const name of ['BRAND_PARENT', 'BRAND_PRODUCT', 'BRAND_FULL']) {
    if (!mobileHeader.includes(name)) failures.push(`mobile Header.vue does not use ${name}`)
  }

  const settings = readText('player/src/pages/mobile/settings.vue')
  if (!settings.includes('BRAND_FULL')) failures.push('mobile settings.vue does not use BRAND_FULL')

  const localeChecks = [
    ['player/src/languages/modules/zh.ts', 'sonic 甄选'],
    ['player/src/languages/modules/en.ts', 'sonic Originals'],
    ['player/src/languages/modules/ja.ts', 'sonic オリジナル'],
  ]
  for (const [file, text] of localeChecks) {
    if (!readText(file).includes(text)) failures.push(`${file} missing localized brand label "${text}"`)
  }

  const brandedFallbackFiles = [
    'player/src/pages/index.vue',
    'player/src/pages/mobile/index.vue',
    'player/src/utils/transformers.ts',
  ]
  for (const file of brandedFallbackFiles) {
    if (!readText(file).includes('BRAND_PRODUCT')) {
      failures.push(`${file} must use BRAND_PRODUCT for brand fallback copy`)
    }
  }

  const routerText = readText('player/src/routers/index.ts')
  for (const name of ['BRAND_FULL', 'BRAND_TITLE']) {
    if (!routerText.includes(name)) failures.push(`player/src/routers/index.ts must use ${name} for route titles`)
  }

  const apiIndex = readText('functions/api/index.ts')
  if (!apiIndex.includes('API_NAME')) failures.push('functions/api/index.ts does not use API_NAME')
  if (!apiIndex.includes('branding')) failures.push('functions/api/index.ts missing additive branding metadata')

  const upstream = readText('functions/_lib/sonic/upstream.ts')
  if (!upstream.includes('.replace(/网易云音乐/g, BRAND_PRODUCT)')) {
    failures.push('upstream.ts display desensitization is not rebranded to the product brand')
  }
  if (upstream.includes(".replace(/网易云音乐/g, 'Sonic')")) {
    failures.push('upstream.ts still desensitizes display text to the old Sonic brand')
  }

  const distIndex = path.join(ROOT, 'player/dist/index.html')
  if (fs.existsSync(distIndex)) {
    const distHtml = fs.readFileSync(distIndex, 'utf8')
    if (!distHtml.includes(`<title>${expected.BRAND_TITLE}</title>`)) {
      failures.push('built player/dist/index.html title is not rebranded')
    }
  } else if (!process.argv.includes('--no-dist')) {
    failures.push('player/dist/index.html missing; run the frontend build first or pass --no-dist')
  }

  const files = listRepositoryFiles()
  const allowed = (file) =>
    DISPLAY_BRAND_ALLOWLIST.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry))

  for (const file of files) {
    const text = readText(file)
    if (DISPLAY_BRAND_CLEAN_FILES.includes(file)) {
      if (/\bSonic\b|Glass Music Player/.test(text)) {
        failures.push(`${file} still contains old display brand "Sonic" or "Glass Music Player"`)
      }
    }
    if (/\bSonic\b|Glass Music Player/.test(text) && !allowed(file) && !DISPLAY_BRAND_CLEAN_FILES.includes(file)) {
      failures.push(`${file} contains old brand text but is not in the functional/legacy allowlist`)
    }
  }

  const glassFiles = files.filter(
    (file) => !file.startsWith('scripts/') && readText(file).includes('Glass Music Player'),
  )
  if (glassFiles.length > 0) {
    failures.push(`Glass Music Player remains in: ${glassFiles.join(', ')}`)
  }

  if (failures.length > 0) {
    console.error('\nBrand verification FAILED:')
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exit(1)
  }

  console.log('Brand verification PASSED: constants, metadata, locales, and display surfaces are consistent.')
}

function main() {
  const [mode, target] = process.argv.slice(2)

  if (mode === '--snapshot') {
    if (!target) {
      console.error('Usage: node scripts/brand-audit.mjs --snapshot <file>')
      process.exit(2)
    }
    const outputPath = path.resolve(ROOT, target)
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    const state = collectState()
    fs.writeFileSync(outputPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    console.log(`Snapshot written to ${normalizePath(path.relative(ROOT, outputPath))}`)
    console.log(`  files scanned: ${state.filesScanned}`)
    console.log(`  protected tokens: ${Object.values(state.protectedEntries).reduce((sum, list) => sum + list.length, 0)}`)
    console.log(`  display brand entries: ${state.displayEntries.length}`)
    return
  }

  if (mode === '--compare') {
    if (!target) {
      console.error('Usage: node scripts/brand-audit.mjs --compare <baseline.json>')
      process.exit(2)
    }
    const before = JSON.parse(fs.readFileSync(path.resolve(ROOT, target), 'utf8'))
    const after = collectState()
    const failures = compareStates(before, after)
    if (failures.length > 0) {
      console.error('\nProtected contract comparison FAILED:')
      for (const failure of failures) {
        console.error(`\n[${failure.token}] ${failure.note}`)
        for (const entry of failure.removed || []) console.error(`  - removed: ${entry}`)
        for (const entry of failure.added || []) console.error(`  + added:   ${entry}`)
        if (failure.removedCount) console.error(`  (removed total: ${failure.removedCount})`)
        if (failure.addedCount) console.error(`  (added total: ${failure.addedCount})`)
      }
      process.exit(1)
    }
    console.log('Protected contract comparison PASSED: routes, wire brand, auth, storage, cache, and deployment identifiers are unchanged.')
    return
  }

  if (mode === '--verify') {
    verify()
    return
  }

  console.error('Usage: node scripts/brand-audit.mjs --snapshot <file> | --compare <baseline.json> | --verify [--no-dist]')
  process.exit(2)
}

main()
