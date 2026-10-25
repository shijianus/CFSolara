import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('reports/brand-keyname/evidence/api')
const readJson = (group, name) => JSON.parse(fs.readFileSync(path.join(root, group, `${name}.json`), 'utf8'))
const readHeaders = (group, name) => fs.readFileSync(path.join(root, group, `${name}.headers.txt`), 'utf8')

const normalize = (value) => JSON.parse(JSON.stringify(value).replace(/https?:\/\/127\.0\.0\.1:\d+/g, 'http://127.0.0.1:PORT'))
const status = (headers) => headers.split(/\r?\n/)[0].trim()
const cors = (headers) => headers
  .split(/\r?\n/)
  .filter((line) => /^access-control-allow-(origin|methods|headers|expose-headers):/i.test(line))
  .map((line) => line.trim().toLowerCase())
  .sort()

const preIndex = normalize(readJson('pre', 'api-index'))
const postIndex = normalize(readJson('final', 'api-index'))
const preEngine = readJson('pre', 'engine-health')
const postEngine = readJson('final', 'engine-health')
const preMusic = readJson('pre', 'music-search')
const postMusic = readJson('final', 'music-search')
const preSearch = readJson('pre', 'search-nexus')
const postSearch = readJson('final', 'search-nexus')

const summarizeSearch = (value) => ({
  brand: value.brand,
  dataKeys: Object.keys(value.data || {}).sort(),
  metaKeys: Object.keys(value.meta || {}).sort(),
  trackKeys: Object.keys(value.data?.tracks?.[0] || {}).sort(),
  firstTitle: value.data?.tracks?.[0]?.title,
  firstArtist: value.data?.tracks?.[0]?.artist,
  firstPlatform: value.data?.tracks?.[0]?.platform,
  countPositive: (value.data?.tracks?.length || 0) > 0,
})

const report = {
  generatedAt: new Date().toISOString(),
  checks: {
    apiIndexDeepEqualIgnoringOrigin: JSON.stringify(preIndex) === JSON.stringify(postIndex),
    apiIndexBranding: postIndex.branding,
    engineHealthDeepEqual: JSON.stringify(preEngine) === JSON.stringify(postEngine),
    optionsStatusEqual: status(readHeaders('pre', 'options')) === status(readHeaders('final', 'options')),
    optionsCorsEqual: JSON.stringify(cors(readHeaders('pre', 'options'))) === JSON.stringify(cors(readHeaders('final', 'options'))),
    musicSearchCoreEqual: {
      ok: preMusic.ok === postMusic.ok,
      source: preMusic.source === postMusic.source,
      query: preMusic.query === postMusic.query,
      count: preMusic.count === postMusic.count,
      tracks: preMusic.tracks?.length === postMusic.tracks?.length,
      first: preMusic.tracks?.[0]?.name === postMusic.tracks?.[0]?.name,
    },
    searchNexusCoreEqual: JSON.stringify(summarizeSearch(preSearch)) === JSON.stringify(summarizeSearch(postSearch)),
  },
  searchNexus: {
    pre: summarizeSearch(preSearch),
    post: summarizeSearch(postSearch),
    postAttempts: postSearch.meta?.attempts?.map((item) => ({ provider: item.provider, ok: item.ok, ms: item.ms })),
  },
  statuses: {
    apiIndex: { pre: status(readHeaders('pre', 'api-index')), post: status(readHeaders('final', 'api-index')) },
    options: { pre: status(readHeaders('pre', 'options')), post: status(readHeaders('final', 'options')) },
    engineHealth: { pre: status(readHeaders('pre', 'engine-health')), post: status(readHeaders('final', 'engine-health')) },
    musicSearch: { pre: status(readHeaders('pre', 'music-search')), post: status(readHeaders('final', 'music-search')) },
    searchNexus: { pre: status(readHeaders('pre', 'search-nexus')), post: status(readHeaders('final', 'search-nexus')) },
  },
}

report.pass = report.checks.apiIndexDeepEqualIgnoringOrigin &&
  report.checks.engineHealthDeepEqual &&
  report.checks.optionsStatusEqual &&
  report.checks.optionsCorsEqual &&
  Object.values(report.checks.musicSearchCoreEqual).every(Boolean) &&
  report.checks.searchNexusCoreEqual

fs.writeFileSync(path.join(root, 'api-pre-vs-post.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))
if (!report.pass) process.exitCode = 1
