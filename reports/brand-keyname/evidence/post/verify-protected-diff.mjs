import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const files = [
  'functions/_lib/auth.ts',
  'functions/_lib/sonic/config.ts',
  'functions/_lib/sonic/index.ts',
  'functions/_lib/sonic/nexus-lyrics.ts',
  'functions/_lib/sonic/nexus-search.ts',
  'functions/_lib/sonic/providers/adapter.ts',
  'functions/_lib/sonic/route-helpers.ts',
  'functions/_lib/sonic/types.ts',
  'functions/_lib/sonic/utils.ts',
  'functions/_lib/types.ts',
  'functions/api/sonic/engine/health.ts',
  'functions/api/sonic/forward.ts',
  'functions/api/sonic/lyrics/index.ts',
  'functions/api/sonic/lyrics/lyriva.ts',
  'functions/api/sonic/lyrics/nexus.ts',
  'functions/api/sonic/lyrics/sync.ts',
  'functions/api/sonic/resolve/stream.ts',
  'player/src/composables/useLyrics.ts',
]

const diff = execFileSync('git', ['diff', '--unified=0', '--', ...files], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
})

const allowedPatterns = [
  /^\s*\/\//,
  /^\s*\*/,
  /^\s*\/\*/,
  /^\s*\/\*\*/,
  /console\.(?:error|warn|log)\(/,
  /^id: string; \/\/ .*$/,
  /^SOLARA_ALLOWED_ORIGINS\?: string;$/,
  /^$/, // a removed blank line can appear when a type field is deleted
]

const changedLines = diff
  .split('\n')
  .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line))
  .map((line) => ({ sign: line[0], text: line.slice(1) }))

const violations = changedLines.filter(({ text }) => !allowedPatterns.some((re) => re.test(text.trim())))

const byKind = {
  comments: changedLines.filter(({ text }) => /^\s*(\/\/|\*|\/\*)/.test(text)).length,
  logs: changedLines.filter(({ text }) => /console\.(?:error|warn|log)\(/.test(text)).length,
  typeOnly: changedLines.filter(({ text }) => /^SOLARA_ALLOWED_ORIGINS\?: string;$/.test(text.trim())).length,
  inlineComments: changedLines.filter(({ text }) => /^id: string; \/\//.test(text.trim())).length,
  total: changedLines.length,
}

const report = {
  checkedFiles: files.length,
  changedLines: byKind,
  violations: violations.map(({ sign, text }) => `${sign}${text}`),
  pass: violations.length === 0,
}

fs.writeFileSync(
  'reports/brand-keyname/evidence/post/protected-file-diff-audit.json',
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
)

console.log(JSON.stringify(report, null, 2))
if (!report.pass) process.exitCode = 1
