import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('reports/brand-keyname/evidence/browser')
const pre = JSON.parse(fs.readFileSync(path.join(root, 'pre/observations.json'), 'utf8'))
const post = JSON.parse(fs.readFileSync(path.join(root, 'post/observations.json'), 'utf8'))
const legacyPre = JSON.parse(fs.readFileSync(path.join(root, 'legacy/pre/observations.json'), 'utf8'))
const legacyPost = JSON.parse(fs.readFileSync(path.join(root, 'legacy/post/observations.json'), 'utf8'))

const normalize = (value) => String(value ?? '')
  .replace(/127\.0\.0\.1:879[0-9]/g, '127.0.0.1:PORT')
  .replace(/\s+/g, ' ')
  .trim()

const legacyRe = /Solara|CFSolara|Shijianus|Glass Music Player|EpoMail|EpoCanvas/g

const steps = pre.steps.map((preStep) => {
  const postStep = post.steps.find((item) => item.name === preStep.name)
  const bodyText = normalize(postStep?.bodyText || postStep?.after?.bodyText || '')
  const legacyHits = [...new Set(bodyText.match(legacyRe) || [])]
  const title = normalize(postStep?.title || postStep?.after?.title)
  const preTitle = normalize(preStep.title)
  const brandText = normalize(postStep?.brandText || postStep?.after?.brandText)
  const preBrandText = normalize(preStep.brandText || preStep.after?.brandText)
  const audio = postStep?.audio || postStep?.after?.audio || []
  const preAudio = preStep.audio || preStep.after?.audio || []
  return {
    name: preStep.name,
    preOk: preStep.ok,
    postOk: postStep?.ok,
    preTitle,
    postTitle: title,
    titleSame: preTitle === title,
    preBrandText,
    postBrandText: brandText,
    brandTextSame: preBrandText === brandText,
    legacyHits,
    preAudioPaused: preAudio.map((item) => item.paused),
    postAudioPaused: audio.map((item) => item.paused),
    postAudioCurrentTime: audio.map((item) => Number(item.currentTime || 0).toFixed(2)),
    preStorageKeys: preStep.localStorageKeys,
    postStorageKeys: postStep.localStorageKeys,
    storageKeysSame: JSON.stringify(preStep.localStorageKeys) === JSON.stringify(postStep?.localStorageKeys),
    screenshots: [preStep.screenshot, postStep?.screenshot].filter(Boolean),
  }
})

const result = {
  generatedAt: new Date().toISOString(),
  preFinishedAt: pre.finishedAt,
  postFinishedAt: post.finishedAt,
  allPostStepsPassed: post.steps.every((step) => step.ok),
  allTitlesEndWithFullBrand: post.steps
    .filter((step) => step.title)
    .every((step) => /epocanvas sonic$/.test(normalize(step.title))),
  noLegacyDisplayBrand: steps.every((step) => step.legacyHits.length === 0),
  allBrandTextStable: steps.every((step) => step.brandTextSame),
  allStorageKeysStable: steps.every((step) => step.storageKeysSame),
  legacyStatic: {
    pre: { title: legacyPre.home.title, epoMailCount: legacyPre.home.epoMailCount, epomailCount: legacyPre.home.epomailCount, modalEpoMailCount: legacyPre.modal.epoMailCount, modalEpomailCount: legacyPre.modal.epomailCount },
    post: { title: legacyPost.home.title, epoMailCount: legacyPost.home.epoMailCount, epomailCount: legacyPost.home.epomailCount, modalEpoMailCount: legacyPost.modal.epoMailCount, modalEpomailCount: legacyPost.modal.epomailCount },
    legacyBrandHitsPost: [
      ...new Set((legacyPost.home.bodyText + ' ' + legacyPost.modal.modalText).match(legacyRe) || []),
    ],
  },
  steps,
}

fs.writeFileSync(path.join(root, 'browser-pre-vs-post.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
  allPostStepsPassed: result.allPostStepsPassed,
  allTitlesEndWithFullBrand: result.allTitlesEndWithFullBrand,
  noLegacyDisplayBrand: result.noLegacyDisplayBrand,
  allBrandTextStable: result.allBrandTextStable,
  allStorageKeysStable: result.allStorageKeysStable,
  legacyStatic: result.legacyStatic,
}, null, 2))
