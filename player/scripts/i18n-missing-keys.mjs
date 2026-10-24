// i18n 缺失键扫描(交付验证第 5 步)
// 1) 三语叶子键对齐  2) 代码引用键(t('..')/$t('..')/labelKey 等)是否在语言包中定义
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const modulesDir = path.join(root, 'src', 'languages', 'modules')

const load = async name => (await import(pathToFileURL(path.join(modulesDir, `${name}.ts`)).href)).default

const flatten = (obj, prefix = '', out = new Map()) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') flatten(v, key, out)
    else out.set(key, v)
  }
  return out
}

const zh = flatten(await load('zh'))
const en = flatten(await load('en'))
const ja = flatten(await load('ja'))

console.log(`叶子键数: zh=${zh.size} en=${en.size} ja=${ja.size}`)

const missingIn = (langMap, name, base, baseName) => {
  const miss = []
  for (const key of base.keys()) if (!langMap.has(key)) miss.push(key)
  console.log(`${name} 相对 ${baseName} 缺失 ${miss.length} 个: ${miss.slice(0, 10).join(', ')}${miss.length > 10 ? ' ...' : ''}`)
  return miss
}

const missEnZh = missingIn(en, 'en', zh, 'zh')
const missJaZh = missingIn(ja, 'ja', zh, 'zh')
const missZhEn = missingIn(zh, 'zh', en, 'en')
const missZhJa = missingIn(zh, 'zh', ja, 'ja')

// 代码引用键扫描
const srcDirs = ['src']
const refKeys = new Set()
const dynamicPrefixes = new Set()
const walk = dir => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name)
    if (f.isDirectory()) { walk(p); continue }
    if (!/\.(vue|ts)$/.test(f.name) || f.name.endsWith('.d.ts')) continue
    const s = fs.readFileSync(p, 'utf8')
    for (const m of s.matchAll(/(?<![\w$.])\$?t\(\s*'([^']+)'\s*[,)]/g)) refKeys.add(m[1])
    for (const m of s.matchAll(/(?<![\w$.])\$?t\(\s*"([^"]+)"\s*[,)]/g)) refKeys.add(m[1])
    for (const m of s.matchAll(/(?:labelKey|titleKey|descKey|label|title)\s*:\s*'([^']+\.[^'.*]+)'/g)) {
      if (!/\$\{|\+/.test(m[1])) refKeys.add(m[1])
    }
    for (const m of s.matchAll(/\$?t\(\s*'([^']+\.)'\s*\+/g)) dynamicPrefixes.add(m[1])
  }
}
walk(path.join(root, 'src'))

const all = new Map([...zh, ...en, ...ja])
const undefinedKeys = []
for (const key of refKeys) {
  if (all.has(key)) continue
  if ([...dynamicPrefixes].some(p => key.startsWith(p))) continue
  // 允许常见动态前缀族
  if (/^(quality|routes|mvList\.categories|player\.playbackError|components\.settings\.themeOptions|search\.tabs|settings\.[a-z]+Options)\./.test(key)) continue
  undefinedKeys.push(key)
}
console.log(`代码引用键: ${refKeys.size} 个;语言包未定义: ${undefinedKeys.length} 个`)
if (undefinedKeys.length) console.log('  未定义:', undefinedKeys.slice(0, 20).join(', '))
console.log(`动态前缀: ${[...dynamicPrefixes].join(', ') || '(无)'}`)

const aligned = missEnZh.length + missJaZh.length + missZhEn.length + missZhJa.length === 0
console.log(`\n结论: 三语对齐=${aligned ? '通过' : '失败'};引用键完整性=${undefinedKeys.length === 0 ? '通过' : '失败'}`)
process.exit(aligned && undefinedKeys.length === 0 ? 0 : 1)
