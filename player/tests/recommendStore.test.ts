import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createApp } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { useRecommendStore } from '@/stores/modules/recommend'
import { useLibraryStore } from '@/stores/modules/library'

describe('recommend store: 隐私控制、不感兴趣负反馈与事件队列', () => {
  beforeEach(() => {
    localStorage.clear()
    const pinia = createPinia()
    pinia.use(piniaPluginPersistedstate)
    createApp({ render: () => null }).use(pinia)
    setActivePinia(pinia)
    vi.restoreAllMocks()
  })

  it('开启个性化时自动生成合法的 anonId 并注入 X-Sonic-Anon-Id 与 X-Sonic-Context', () => {
    const rec = useRecommendStore()
    const lib = useLibraryStore()
    lib.toggleLikeSong({ id: 186016, name: '晴天', artist: '周杰伦', duration: 269000 })

    expect(rec.personalizationEnabled).toBe(true)
    const headers = rec.buildRequestHeaders(true)
    expect(headers['X-Sonic-Anon-Id']).toMatch(/^anon_[0-9a-f]{24}$/)
    expect(headers['X-Sonic-Context']).toBeTruthy()
    expect(headers['X-Sonic-Personalization']).toBeUndefined()
  })

  it('关闭个性化后立即返回 X-Sonic-Personalization: off 且不再附带 anonId 或上下文', () => {
    const rec = useRecommendStore()
    rec.ensureAnonId()
    rec.setPersonalizationEnabled(false)

    const headers = rec.buildRequestHeaders(true)
    expect(headers).toEqual({ 'X-Sonic-Personalization': 'off' })
    expect(headers['X-Sonic-Anon-Id']).toBeUndefined()
    expect(headers['X-Sonic-Context']).toBeUndefined()
  })

  it('不感兴趣曲目支持标记、查询与撤销，并持久化在列表中', () => {
    const rec = useRecommendStore()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))

    expect(rec.isSongDisliked(108914)).toBe(false)
    rec.dislikeSong({
      id: 108914,
      canonicalTrackId: 'trk_1234567890abcdef',
      name: '测试歌曲',
      artist: '测试歌手',
      duration: 210000,
    })

    expect(rec.isSongDisliked(108914)).toBe(true)
    expect(rec.isSongDisliked('trk_1234567890abcdef')).toBe(true)
    expect(rec.dislikedCount).toBe(1)

    rec.undislikeSong(108914)
    expect(rec.isSongDisliked(108914)).toBe(false)
    expect(rec.dislikedCount).toBe(0)
  })

  it('重置推荐画像会清空 dislikedTracks 并向服务端发送 DELETE /api/sonic/events', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ code: 200 }), { status: 200 }))

    const rec = useRecommendStore()
    rec.dislikeSong({ id: 999, name: '不喜欢', artist: '某歌手' })
    expect(rec.dislikedCount).toBe(1)

    const ok = await rec.clearAllRecommendationProfile()
    expect(ok).toBe(true)
    expect(rec.dislikedCount).toBe(0)
    expect(
      fetchSpy.mock.calls.some(
        (call) => String(call[0]).includes('/api/sonic/events') && (call[1] as any)?.method === 'DELETE'
      )
    ).toBe(true)
  })

  it('事件批量发送失败后整批回到队首,随下一次批量一起重试', async () => {
    vi.useFakeTimers()
    try {
      const rec = useRecommendStore()
      rec.personalizationEnabled = true
      rec.anonId = 'anon_testretry0000000000000a'

      const postCalls: Array<{ url: string; body?: string }> = []
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init?: any) => {
        if (String(url).includes('/api/sonic/events') && init?.method !== 'DELETE') {
          postCalls.push({ url: String(url), body: init?.body })
          // 第一次 POST 失败(网关 5xx),第二次成功
          return postCalls.length === 1
            ? new Response('err', { status: 502 })
            : new Response('{}', { status: 200 })
        }
        return new Response('{}', { status: 200 })
      })

      rec.recordEvent({ type: 'play_start', track: { id: 1, title: '晴天', artist: '周杰伦' } })
      await vi.advanceTimersByTimeAsync(1300)
      expect(postCalls.length).toBe(1)

      // 首次失败后新事件入队应触发重试,且批次包含上一轮失败的事件
      rec.recordEvent({ type: 'favorite', track: { id: 2, title: '夜曲', artist: '周杰伦' } })
      await vi.advanceTimersByTimeAsync(1300)
      expect(postCalls.length).toBe(2)

      const retryBody = JSON.parse(postCalls[1].body || '{}')
      const retriedTypes = (retryBody.events || []).map((e: any) => e.type)
      expect(retriedTypes).toContain('play_start')
      expect(retriedTypes).toContain('favorite')
    } finally {
      vi.useRealTimers()
    }
  })

  it('关闭个性化后 recordEvent 完全不产生网络上报', async () => {
    vi.useFakeTimers()
    try {
      const rec = useRecommendStore()
      rec.personalizationEnabled = false
      const fetchMock = vi.spyOn(globalThis, 'fetch')

      rec.recordEvent({ type: 'favorite', track: { id: 3, title: '演员', artist: '薛之谦' } })
      await vi.advanceTimersByTimeAsync(2000)

      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/sonic/events'))
      ).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
