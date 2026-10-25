import { describe, it, expect, beforeEach } from 'vitest'
import {
  toSimplifiedChinese,
  toPinyinInfo,
  getArtistAliases,
  resolveCanonicalArtist,
  getRelatedArtists,
  classifyTrackEdition,
  damerauLevenshtein,
  expandQueryAliases,
  computeCanonicalTrackId,
  toCanonicalTrack,
  canMergeCanonicalTracks,
  mergeCanonicalTracks,
  MemoryRecommendStore,
  resetMemoryRecommendStoreForTest,
  ensureCatalogSeeded,
  computeCatalogPopularity,
  computeEventCredibilityWeight,
  ingestBehaviorEvents,
  getRecommendationsForYou,
  getTrendingRecommendations,
  getSimilarRecommendations,
  getDiscoverRecommendations,
  executeSmartSearch,
  executeSmartSuggest,
  type UserIdentityContext,
} from '../functions/_lib/sonic/recommend'
import { SqliteRecommendStore } from '../server/recommend-sqlite'
import { onRequest as onForYouRequest } from '../functions/api/sonic/recommend/for-you'
import { onRequest as onTrendingRequest } from '../functions/api/sonic/recommend/trending'
import { onRequest as onSimilarRequest } from '../functions/api/sonic/recommend/similar'
import { onRequest as onDiscoverRequest } from '../functions/api/sonic/recommend/discover'
import { onRequest as onSmartSearchRequest } from '../functions/api/sonic/search/smart'
import { onRequest as onEventsRequest } from '../functions/api/sonic/events'

describe('CFSolara 智能音乐推荐与混合搜索引擎全链路测试', () => {
  let store: MemoryRecommendStore
  let env: any

  beforeEach(() => {
    resetMemoryRecommendStoreForTest()
    store = new MemoryRecommendStore()
    ensureCatalogSeeded(store)
    env = {
      RECOMMEND_STORE: store,
      SONIC_RECOMMEND_OFFLINE: '1',
    }
  })

  describe('1. 文本归一、简繁转换、拼音/首字母、歌手别名与拼写容错', () => {
    it('繁体中文歌名与歌手名准确转换为简体中文', () => {
      expect(toSimplifiedChinese('陳奕迅 富士山下')).toBe('陈奕迅 富士山下')
      expect(toSimplifiedChinese('周杰倫 發如雪 聽媽媽的話')).toBe('周杰伦 发如雪 听妈妈的话')
      expect(toSimplifiedChinese('鄧紫棋 泡沫')).toBe('邓紫棋 泡沫')
    })

    it('提取全拼与拼音首字母支持常见汉字及 Intl Collator 兜底', () => {
      const py = toPinyinInfo('周杰伦 晴天')
      expect(py.full).toContain('zhoujielun')
      expect(py.full).toContain('qingtian')
      expect(py.initials).toContain('zjl')
      expect(py.initials).toContain('qt')
    })

    it('歌手中英文名与艺名双向扩展及相似歌手图谱', () => {
      expect(resolveCanonicalArtist('Jay Chou')).toBe('周杰伦')
      expect(resolveCanonicalArtist('G.E.M.')).toBe('邓紫棋')
      expect(resolveCanonicalArtist('Eason Chan')).toBe('陈奕迅')
      expect(getArtistAliases('周杰伦')).toEqual(expect.arrayContaining(['周杰伦', 'jay chou']))
      expect(getRelatedArtists('周杰伦')).toContain('林俊杰')
    })

    it('歌曲版本自动识别区分 studio 原版与 live/remix/cover/instrumental', () => {
      expect(classifyTrackEdition('晴天')).toBe('studio')
      expect(classifyTrackEdition('晴天 (Live)')).toBe('live')
      expect(classifyTrackEdition('晴天 (伴奏)')).toBe('instrumental')
      expect(classifyTrackEdition('晴天 (翻唱版)')).toBe('cover')
      expect(classifyTrackEdition('晴天 (Remix)')).toBe('remix')
    })

    it('Damerau-Levenshtein 相邻字符换位编辑距离为 1 且支持查询纠错扩展', () => {
      expect(damerauLevenshtein('coldpaly', 'coldplay')).toBe(1)
      expect(damerauLevenshtein('tayler', 'taylor')).toBe(1)
      expect(expandQueryAliases('coldpaly').matchedArtist).toBe('Coldplay')
    })
  })

  describe('2. 跨平台曲目实体归一与误合并防护', () => {
    it('不同平台的同一首录音室原版合并为同一个 canonicalTrackId 并聚合多源 ID', () => {
      const ne = toCanonicalTrack({
        id: 'ne_186016',
        platform: 'netease',
        platformId: '186016',
        title: '晴天',
        artist: '周杰伦',
        album: '叶惠美',
        duration: 269,
      })
      const qq = toCanonicalTrack({
        id: 'qq_0039MnYb0qxYhV',
        platform: 'qq',
        platformId: '0039MnYb0qxYhV',
        title: '晴天',
        artist: 'Jay Chou',
        album: '叶惠美',
        duration: 269,
      })
      expect(ne).not.toBeNull()
      expect(qq).not.toBeNull()
      expect(ne!.canonicalTrackId).toBe(qq!.canonicalTrackId)
      expect(canMergeCanonicalTracks(ne!, qq!)).toBe(true)

      const merged = mergeCanonicalTracks(ne!, qq!)
      expect(merged.sourceIds.netease).toBe('186016')
      expect(merged.sourceIds.qq).toBe('0039MnYb0qxYhV')
      expect(merged.availableSources.length).toBeGreaterThanOrEqual(2)
    })

    it('同名不同歌手、原版与 Live/翻唱/伴奏版本及 30s 铃声片段严禁合并为同一首', () => {
      const jayStudio = computeCanonicalTrackId('晴天', '周杰伦', 'studio')
      const otherArtist = computeCanonicalTrackId('晴天', '刘瑞琦', 'studio')
      const jayLive = computeCanonicalTrackId('晴天', '周杰伦', 'live')
      const jayCover = computeCanonicalTrackId('晴天', '周杰伦', 'cover')
      const jayInst = computeCanonicalTrackId('晴天', '周杰伦', 'instrumental')

      expect(new Set([jayStudio, otherArtist, jayLive, jayCover, jayInst]).size).toBe(5)

      const fullSong = toCanonicalTrack({
        id: 'ne_186016',
        platform: 'netease',
        platformId: '186016',
        title: '晴天',
        artist: '周杰伦',
        duration: 269,
      })!
      const ringtone = toCanonicalTrack({
        id: 'kuwo_999',
        platform: 'kuwo',
        platformId: '999',
        title: '晴天',
        artist: '周杰伦',
        duration: 28,
      })!
      expect(canMergeCanonicalTracks(fullSong, ringtone)).toBe(false)
    })
  })

  describe('3. 真实站内热度计算、防刷榜与外部热榜严格分离', () => {
    it('无站内播放时 internalScore 严格为 0，与 externalChartScore 清晰分离', () => {
      const track = toCanonicalTrack(
        {
          id: 'ne_186016',
          platform: 'netease',
          platformId: '186016',
          title: '晴天',
          artist: '周杰伦',
          duration: 269,
        },
        { externalPopularity: 95 }
      )!
      const popMap = computeCatalogPopularity([track], [])
      const pop = popMap.get(track.canonicalTrackId)!
      expect(pop.internalScore).toBe(0)
      expect(pop.externalChartScore).toBeCloseTo(0.95, 2)
      expect(pop.primarySource).toBe('external-chart')
    })

    it('防刷机制：单用户循环刷播 100 次的热度显著低于 8 位真实独立听众正常完播与收藏', () => {
      const now = Date.now()
      const trackSpammed = toCanonicalTrack({
        id: 'ne_1',
        platform: 'netease',
        platformId: '1',
        title: '刷榜测试曲',
        artist: '歌手A',
        duration: 200,
      })!
      const trackOrganic = toCanonicalTrack({
        id: 'ne_2',
        platform: 'netease',
        platformId: '2',
        title: '真实热播曲',
        artist: '歌手B',
        duration: 200,
      })!

      // 单一用户刷播 100 次
      const spamEvents = Array.from({ length: 100 }, (_, i) => ({
        eventId: `spam_${i}`,
        subjectKey: 'anon:spammer_01',
        canonicalTrackId: trackSpammed.canonicalTrackId,
        type: 'play_complete' as const,
        createdAt: now - i * 1000,
        weight: 2.5,
      }))

      // 8 位独立听众正常完播 + 4 人收藏
      const organicEvents = [
        ...Array.from({ length: 8 }, (_, i) => ({
          eventId: `org_play_${i}`,
          subjectKey: `anon:listener_${i}`,
          canonicalTrackId: trackOrganic.canonicalTrackId,
          type: 'play_complete' as const,
          createdAt: now - i * 60_000,
          weight: 2.5,
        })),
        ...Array.from({ length: 4 }, (_, i) => ({
          eventId: `org_fav_${i}`,
          subjectKey: `anon:listener_${i}`,
          canonicalTrackId: trackOrganic.canonicalTrackId,
          type: 'favorite' as const,
          createdAt: now - i * 60_000,
          weight: 4.0,
        })),
      ]

      const popMap = computeCatalogPopularity(
        [trackSpammed, trackOrganic],
        [...spamEvents, ...organicEvents],
        { window: '7d', nowMs: now }
      )
      const popSpam = popMap.get(trackSpammed.canonicalTrackId)!
      const popOrganic = popMap.get(trackOrganic.canonicalTrackId)!

      expect(popSpam.uniqueListeners).toBe(1)
      expect(popOrganic.uniqueListeners).toBe(8)
      expect(popOrganic.internalScore).toBeGreaterThan(popSpam.internalScore)
    })

    it('指数时间衰减：24 小时内的新近收听热度显著高于 6 天前的旧收听', () => {
      const now = Date.now()
      const trackRecent = toCanonicalTrack({
        id: 'ne_3',
        platform: 'netease',
        platformId: '3',
        title: '新近热歌',
        artist: '歌手C',
        duration: 210,
      })!
      const trackStale = toCanonicalTrack({
        id: 'ne_4',
        platform: 'netease',
        platformId: '4',
        title: '六天前旧歌',
        artist: '歌手D',
        duration: 210,
      })!

      const events = [
        ...Array.from({ length: 5 }, (_, i) => ({
          eventId: `rec_${i}`,
          subjectKey: `anon:u_${i}`,
          canonicalTrackId: trackRecent.canonicalTrackId,
          type: 'play_complete' as const,
          createdAt: now - 2 * 3600 * 1000,
          weight: 2.5,
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          eventId: `old_${i}`,
          subjectKey: `anon:u_${i}`,
          canonicalTrackId: trackStale.canonicalTrackId,
          type: 'play_complete' as const,
          createdAt: now - 6 * 24 * 3600 * 1000,
          weight: 2.5,
        })),
      ]

      const popMap = computeCatalogPopularity([trackRecent, trackStale], events, {
        window: '7d',
        nowMs: now,
      })
      expect(popMap.get(trackRecent.canonicalTrackId)!.internalScore).toBeGreaterThan(
        popMap.get(trackStale.canonicalTrackId)!.internalScore
      )
    })
  })

  describe('4. 反馈信号可信度、网络卡顿/试听保护、不喜欢过滤与多样性控制', () => {
    it('网络卡顿、播放报错与 30s 试听结束绝不被误判为用户不喜欢，明确 dislike 则立即屏蔽', async () => {
      expect(computeEventCredibilityWeight({ type: 'skip', reason: 'network_stall' })).toBe(0)
      expect(computeEventCredibilityWeight({ type: 'skip', reason: 'playback_error' })).toBe(0)
      expect(computeEventCredibilityWeight({ type: 'skip', reason: 'trial_end' })).toBe(0)
      expect(computeEventCredibilityWeight({ type: 'skip', reason: 'user_skip', playedSeconds: 5 })).toBeLessThan(0)
      expect(computeEventCredibilityWeight({ type: 'dislike' })).toBeLessThan(-3)

      const identity: UserIdentityContext = {
        mode: 'anonymous-opt-in',
        subjectKey: 'anon:tester_credibility',
        personalizationEnabled: true,
      }

      // 1. 上报网络卡顿与试听结束：不应入库污染负向偏好
      await ingestBehaviorEvents(
        [
          {
            eventId: 'ev_net_stall',
            type: 'skip',
            reason: 'network_stall',
            track: { id: '186016', title: '晴天', artist: '周杰伦', duration: 269 },
          },
          {
            eventId: 'ev_trial_end',
            type: 'skip',
            reason: 'trial_end',
            track: { id: '186016', title: '晴天', artist: '周杰伦', duration: 269 },
          },
        ],
        identity,
        env
      )
      expect(store.getUserEvents(identity.subjectKey!)).toHaveLength(0)

      // 2. 上报明确 dislike：该曲立即从推荐列表中被过滤排除
      await ingestBehaviorEvents(
        [
          {
            eventId: 'ev_dislike_qingtian',
            type: 'dislike',
            track: { id: '186016', title: '晴天', artist: '周杰伦', duration: 269 },
          },
        ],
        identity,
        env
      )

      const rec = await getRecommendationsForYou(identity, { count: 25 }, env)
      expect(rec.tracks.some((t) => t.title === '晴天' && t.artist === '周杰伦')).toBe(false)
    })

    it('冷启动新用户与有行为画像用户的推荐均限制单歌手垄断且过滤不可播放音源', async () => {
      // 插入一首不可播放曲目
      const unplayable = toCanonicalTrack({
        id: 'ne_unplayable_999',
        platform: 'netease',
        platformId: '99999999',
        title: '无音源测试歌',
        artist: '周杰伦',
        duration: 240,
        streamType: 'unavailable',
      })!
      store.upsertTrack(unplayable)

      const coldIdentity: UserIdentityContext = {
        mode: 'public',
        subjectKey: null,
        personalizationEnabled: false,
      }
      const coldRec = await getRecommendationsForYou(coldIdentity, { count: 16 }, env)
      expect(coldRec.tracks.length).toBeGreaterThanOrEqual(8)
      expect(coldRec.tracks.some((t) => t.id === '99999999')).toBe(false)

      // 统计单歌手出现次数上限（冷启动 maxPerArtist = 2）
      const artistCounts = new Map<string, number>()
      for (const t of coldRec.tracks) {
        artistCounts.set(t.artist, (artistCounts.get(t.artist) || 0) + 1)
      }
      for (const [, c] of artistCounts) {
        expect(c).toBeLessThanOrEqual(3)
      }
    })

    it('收藏、完播与搜索点击行为闭环能够驱动猜你喜欢向对应歌手/流派演化', async () => {
      const identity: UserIdentityContext = {
        mode: 'anonymous-opt-in',
        subjectKey: 'anon:rock_lover',
        personalizationEnabled: true,
      }

      await ingestBehaviorEvents(
        [
          {
            type: 'favorite',
            track: {
              id: '347230',
              title: '海阔天空',
              artist: 'Beyond',
              album: '乐与怒',
              duration: 326,
              genres: ['rock', 'cantopop'],
            },
          },
          {
            type: 'play_complete',
            track: {
              id: '167876',
              title: '平凡之路',
              artist: '朴树',
              album: '猎户星座',
              duration: 301,
              genres: ['folk', 'rock'],
            },
          },
          {
            type: 'search_click',
            query: '万能青年旅店',
            track: {
              id: '386844',
              title: '杀死那个石家庄人',
              artist: '万能青年旅店',
              duration: 344,
              genres: ['rock', 'indie'],
            },
          },
        ],
        identity,
        env
      )

      const rec = await getRecommendationsForYou(identity, { count: 12 }, env)
      expect(rec.personalized).toBe(true)
      expect(rec.profileSummary.hasHistory).toBe(true)
      expect(rec.profileSummary.topArtists).toEqual(expect.arrayContaining(['Beyond']))
      expect(rec.tracks.some((t) => t.explanation.primaryReason.length > 0)).toBe(true)
    })

    it('相似歌曲接口支持曲库外冷启动新歌 Seed 并诚实声明 audioFeaturesUsed=false', async () => {
      const identity: UserIdentityContext = {
        mode: 'public',
        subjectKey: null,
        personalizationEnabled: false,
      }
      const sim = await getSimilarRecommendations(
        identity,
        {
          title: '半岛铁盒',
          artist: '周杰伦',
          album: '八度空间',
          count: 8,
        },
        env
      )
      expect(sim.audioFeaturesUsed).toBe(false)
      expect(sim.tracks.length).toBeGreaterThan(0)
      expect(sim.similarArtists).toEqual(expect.arrayContaining(['林俊杰']))
      expect(sim.tracks[0].explanation.similarityBasis).toBeTruthy()
    })
  })

  describe('5. 智能搜索引擎：多字段检索、拼音/简繁/别名/容错、相关性门控与零结果兜底', () => {
    it('支持简体、繁体、全拼、拼音首字母、英文艺名与拼写容错检索', async () => {
      const publicIdentity: UserIdentityContext = {
        mode: 'public',
        subjectKey: null,
        personalizationEnabled: false,
      }

      // 1. 繁体检索「陳奕迅 富士山下」
      const tradRes = await executeSmartSearch(
        '陳奕迅 富士山下',
        { skipLiveUpstream: true },
        publicIdentity,
        env
      )
      expect(tradRes.data.tracks.length).toBeGreaterThan(0)
      expect(tradRes.data.tracks[0].title).toBe('富士山下')

      // 2. 拼音检索「qingtian」
      const pinyinRes = await executeSmartSearch(
        'qingtian',
        { skipLiveUpstream: true },
        publicIdentity,
        env
      )
      expect(pinyinRes.data.tracks.length).toBeGreaterThan(0)
      expect(pinyinRes.data.tracks[0].title).toBe('晴天')

      // 3. 拼音首字母检索「zjl」
      const initRes = await executeSmartSearch(
        'zjl',
        { skipLiveUpstream: true },
        publicIdentity,
        env
      )
      expect(initRes.data.tracks.some((t) => t.artist === '周杰伦')).toBe(true)

      // 4. 英文别名检索「jay chou」
      const aliasRes = await executeSmartSearch(
        'jay chou',
        { skipLiveUpstream: true },
        publicIdentity,
        env
      )
      expect(aliasRes.data.tracks.some((t) => t.artist === '周杰伦')).toBe(true)

      // 5. 英文拼写容错检索「coldpaly」
      const typoRes = await executeSmartSearch(
        'coldpaly',
        { skipLiveUpstream: true },
        publicIdentity,
        env
      )
      expect(typoRes.data.tracks.some((t) => t.artist.toLowerCase().includes('coldplay'))).toBe(
        true
      )
    })

    it('【铁律验证】不能为了个性化破坏搜索准确性：重度偏好其他歌手的用户搜索《晴天》，第一名必须仍是《晴天》', async () => {
      const heavyOtherFan: UserIdentityContext = {
        mode: 'anonymous-opt-in',
        subjectKey: 'anon:heavy_jj_swift_fan',
        personalizationEnabled: true,
      }

      // 构造极端偏爱林俊杰与 Taylor Swift 的用户画像
      for (let i = 0; i < 15; i++) {
        await ingestBehaviorEvents(
          [
            {
              eventId: `jj_fav_${i}`,
              type: 'favorite',
              track: { id: '108914', title: '江南', artist: '林俊杰', duration: 267 },
            },
            {
              eventId: `ts_play_${i}`,
              type: 'play_complete',
              track: { id: '19850216', title: 'Love Story', artist: 'Taylor Swift', duration: 235 },
            },
          ],
          heavyOtherFan,
          env
        )
      }

      const searchRes = await executeSmartSearch(
        '晴天',
        { personalize: true, skipLiveUpstream: true },
        heavyOtherFan,
        env
      )

      expect(searchRes.data.tracks.length).toBeGreaterThan(0)
      expect(searchRes.data.tracks[0].title).toBe('晴天')
      expect(searchRes.data.tracks[0].artist).toBe('周杰伦')
    })

    it('录音室原版优先于翻唱/伴奏版本，且无匹配结果时触发可播放智能兜底', async () => {
      const identity: UserIdentityContext = {
        mode: 'public',
        subjectKey: null,
        personalizationEnabled: false,
      }

      // 注入《晴天 (翻唱版)》和《晴天 (伴奏)》
      store.upsertTracks([
        toCanonicalTrack({
          id: 'ne_cover_1',
          platform: 'netease',
          platformId: '900001',
          title: '晴天 (翻唱版)',
          artist: '某翻唱歌手',
          duration: 268,
        })!,
        toCanonicalTrack({
          id: 'ne_inst_1',
          platform: 'netease',
          platformId: '900002',
          title: '晴天 (伴奏)',
          artist: '周杰伦',
          duration: 269,
        })!,
      ])

      const res = await executeSmartSearch('晴天', { skipLiveUpstream: true }, identity, env)
      expect(res.data.tracks[0].edition).toBe('studio')
      expect(res.data.tracks[0].artist).toBe('周杰伦')

      // 零结果查询触发智能兜底
      const zeroRes = await executeSmartSearch(
        'zzzz_nonexistent_track_999999',
        { skipLiveUpstream: true },
        identity,
        env
      )
      expect(zeroRes.data.tracks).toHaveLength(0)
      expect(zeroRes.data.fallbackUsed).toBe(true)
      expect(zeroRes.data.fallbackTracks!.length).toBeGreaterThan(0)
    })

    it('搜索自动补全 (mode=suggest) 支持前缀、拼音与歌手建议', () => {
      const suggestions = executeSmartSuggest('zhoujielun', 6, undefined, env)
      expect(suggestions.length).toBeGreaterThan(0)
      expect(suggestions.some((s) => s.text.includes('周杰伦'))).toBe(true)
    })
  })

  describe('6. SQLite WAL + FTS5 持久化存储引擎 (SqliteRecommendStore)', () => {
    it('支持曲目入库、FTS5 全文检索、事件幂等去重、共现累计与用户数据清除', () => {
      const sqliteStore = new SqliteRecommendStore(':memory:')
      ensureCatalogSeeded(sqliteStore)
      expect(sqliteStore.kind).toBe('sqlite')

      const stats0 = sqliteStore.getStats()
      expect(stats0.trackCount).toBeGreaterThanOrEqual(50)

      // FTS5 检索
      const hits = sqliteStore.searchLocalTracks('周杰伦 晴天', 5)
      expect(hits.length).toBeGreaterThan(0)
      expect(hits[0].title).toBe('晴天')

      // 事件幂等写入：相同 eventId 重复上报只入库 1 次
      const ev = {
        eventId: 'idem_event_001',
        subjectKey: 'anon:sqlite_user',
        canonicalTrackId: hits[0].canonicalTrackId,
        type: 'favorite' as const,
        createdAt: Date.now(),
        weight: 4.0,
      }
      expect(sqliteStore.recordEvent(ev)).toEqual({ inserted: true, deduplicated: false })
      expect(sqliteStore.recordEvent(ev)).toEqual({ inserted: false, deduplicated: true })
      expect(sqliteStore.getUserEvents('anon:sqlite_user')).toHaveLength(1)

      // 曲目共现关系写入与读取
      sqliteStore.incrementCooccurrence(hits[0].canonicalTrackId, 'trk_neighbor_01', 1.5)
      const neighbors = sqliteStore.getCooccurringTracks(hits[0].canonicalTrackId, 5)
      expect(neighbors[0]).toEqual({ canonicalTrackId: 'trk_neighbor_01', weight: 1.5 })

      // 清除指定用户行为数据
      const removed = sqliteStore.clearUserEvents('anon:sqlite_user')
      expect(removed).toBe(1)
      expect(sqliteStore.getUserEvents('anon:sqlite_user')).toHaveLength(0)

      sqliteStore.close()
    })
  })

  describe('7. Edge / VPS 路由网关、VPS 离线降级与缓存隐私隔离', () => {
    it('当携带用户标识头时强制返回 Cache-Control: private, no-store 防止 CDN 缓存投毒', async () => {
      const req = new Request('https://cfsolara.test/api/sonic/recommend/for-you?count=6', {
        headers: {
          'X-Sonic-Anon-Id': 'anon_1234567890abcdef',
        },
      })
      const resp = await onForYouRequest({
        request: req,
        env,
      })
      expect(resp.status).toBe(200)
      expect(resp.headers.get('Cache-Control')).toBe('private, no-store')
      const body = await resp.json()
      expect(body.brand).toBe('Sonic')
      expect(body.data.tracks.length).toBeGreaterThan(0)
    })

    it('当 VPS 主节点返回 530 时，Cloudflare Edge 自动熔断并在边缘完成推荐与智能搜索兜底', async () => {
      const origFetch = globalThis.fetch
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const urlStr = typeof input === 'string' ? input : input.toString()
        if (urlStr.startsWith('https://vps-dead.example.com')) {
          return new Response('Cloudflare Tunnel Error', { status: 530 })
        }
        return origFetch(input as any)
      }) as typeof fetch

      try {
        const envWithDeadVps = {
          SONIC_ENABLE_LOCAL_ENGINE: '1',
          SONIC_LOCAL_ENGINE_URL: 'https://vps-dead.example.com',
          SONIC_RECOMMEND_OFFLINE: '1',
          RECOMMEND_STORE: store,
        } as any

        const trendResp = await onTrendingRequest({
          request: new Request('https://cfsolara.test/api/sonic/recommend/trending?window=7d'),
          env: envWithDeadVps,
        })
        expect(trendResp.status).toBe(200)
        expect(trendResp.headers.get('X-Sonic-Degraded')).toBe('1')
        const trendJson = await trendResp.json()
        expect(trendJson.data.tracks.length).toBeGreaterThan(0)

        const simResp = await onSimilarRequest({
          request: new Request(
            'https://cfsolara.test/api/sonic/recommend/similar?title=%E6%99%B4%E5%A4%A9&artist=%E5%91%A8%E6%9D%B0%E4%BC%A6'
          ),
          env: envWithDeadVps,
        })
        expect(simResp.status).toBe(200)

        const discResp = await onDiscoverRequest({
          request: new Request(
            'https://cfsolara.test/api/sonic/recommend/discover?genre=R%26B&temperature=0.6'
          ),
          env: envWithDeadVps,
        })
        expect(discResp.status).toBe(200)

        const smartResp = await onSmartSearchRequest({
          request: new Request('https://cfsolara.test/api/sonic/search/smart?q=qingtian'),
          env: envWithDeadVps,
        })
        expect(smartResp.status).toBe(200)
        const smartJson = await smartResp.json()
        expect(smartJson.data.tracks[0].title).toBe('晴天')
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('POST / DELETE /api/sonic/events 遵循隐私开关与单批清空语义', async () => {
      // 1. 隐私关闭时不记录任何事件
      const optOutResp = await onEventsRequest({
        request: new Request('https://cfsolara.test/api/sonic/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Sonic-Personalization': 'off',
            'X-Sonic-Anon-Id': 'anon_optout_user_001',
          },
          body: JSON.stringify({
            events: [{ type: 'favorite', track: { id: '186016', title: '晴天', artist: '周杰伦' } }],
          }),
        }),
        env,
      })
      const optOutJson = await optOutResp.json()
      expect(optOutJson.data.accepted).toBe(0)
      expect(optOutJson.data.ignoredByPrivacy).toBe(1)

      // 2. 正常匿名上报与 DELETE 清空
      const postResp = await onEventsRequest({
        request: new Request('https://cfsolara.test/api/sonic/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Sonic-Anon-Id': 'anon_active_user_002',
          },
          body: JSON.stringify({
            events: [{ type: 'favorite', track: { id: '186016', title: '晴天', artist: '周杰伦' } }],
          }),
        }),
        env,
      })
      const postJson = await postResp.json()
      expect(postJson.data.accepted).toBe(1)

      const delResp = await onEventsRequest({
        request: new Request('https://cfsolara.test/api/sonic/events', {
          method: 'DELETE',
          headers: {
            'X-Sonic-Anon-Id': 'anon_active_user_002',
          },
        }),
        env,
      })
      const delJson = await delResp.json()
      expect(delJson.data.removedEvents).toBe(1)
    })
  })
})
