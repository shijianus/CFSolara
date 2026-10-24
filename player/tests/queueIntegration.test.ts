import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createApp } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { useAudioStore } from '@/stores/modules/audio'
import type { Song } from '@/stores/interface'

/**
 * 队列集成回归(对应交付验证第 4 步):
 * 三种入口共享同一 audio store 队列状态:
 *  1. 桌面/移动列表"单击行播放" = setPlaylist(整页, 点击位置) + playSong
 *  2. 播放器内 playAfterCurrent = 插播到当前曲目之后
 *  3. MobileSongList 队列上下文点击 = playByIndex(仅切换当前曲目,不改队列)
 * 本测试按这三条真实调用路径组合验证队列正确性。
 */

const song = (id: number, name: string): Song =>
  ({
    id,
    name,
    artist: '测试歌手',
    duration: 180000,
    url: `/api/music/stream?id=${id}`,
  }) as unknown as Song

describe('队列集成:单击行播放 + playAfterCurrent + MobileSongList 队列点击', () => {
  beforeEach(() => {
    localStorage.clear()
    const pinia = createPinia()
    pinia.use(piniaPluginPersistedstate)
    createApp({ render: () => null }).use(pinia)
    setActivePinia(pinia)
  })

  const readyStore = () => {
    const store = useAudioStore()
    store.initAudio()
    // jsdom 不实现媒体播放,stub 掉 play/pause 避免噪声
    if (store.audio.audio) {
      vi.spyOn(store.audio.audio, 'play').mockResolvedValue(undefined as never)
      vi.spyOn(store.audio.audio, 'pause').mockImplementation(() => {})
    }
    return store
  }

  it('单击行播放:整页入队并从点击位置起播(SongList/MobileSongList 通用列表路径)', () => {
    const store = readyStore()
    const page = [1, 2, 3, 4, 5].map(i => song(1000 + i, `歌曲 ${i}`))
    // 模拟单击第 3 行(index 2)
    store.setPlaylist(page.slice(), 2)
    store.playSong(page[2], 2)
    expect(store.audio.playlist).toHaveLength(5)
    expect(store.audio.currentSong?.id).toBe(1003)
    expect(store.audio.currentIndex).toBe(2)
    expect(store.audio.originalPlaylist).toHaveLength(5)
  })

  it('playAfterCurrent:新歌插入当前曲目之后', () => {
    const store = readyStore()
    const page = [1, 2, 3].map(i => song(1000 + i, `歌曲 ${i}`))
    store.setPlaylist(page.slice(), 0)
    store.playSong(page[0], 0)
    store.playAfterCurrent(song(9999, '插播'))
    expect(store.audio.playlist.map(s => s.id)).toEqual([1001, 9999, 1002, 1003])
    expect(store.audio.currentIndex).toBe(1)
    expect(store.audio.currentSong?.id).toBe(9999)
    expect(store.audio.originalPlaylist.map(s => s.id)).toEqual(store.audio.playlist.map(s => s.id))
  })

  it('playAfterCurrent:队列内已有歌曲被移动到当前之后,原位置移除且索引校正(前移场景)', () => {
    const store = readyStore()
    const page = [1, 2, 3, 4].map(i => song(1000 + i, `歌曲 ${i}`))
    store.setPlaylist(page.slice(), 0)
    store.playSong(page[0], 0)
    // 尾部歌曲插播到当前之后
    store.playAfterCurrent(song(1004, '歌曲 4'))
    expect(store.audio.playlist.map(s => s.id)).toEqual([1001, 1004, 1002, 1003])
    expect(store.audio.currentIndex).toBe(1)
    // 后方歌曲再次插播到当前之后
    store.playAfterCurrent(song(1002, '歌曲 2'))
    expect(store.audio.playlist.map(s => s.id)).toEqual([1001, 1004, 1002, 1003])
    expect(store.audio.currentIndex).toBe(2)
    expect(store.audio.currentSong?.id).toBe(1002)
  })

  it('playAfterCurrent:对当前曲目重复调用不改变队列', () => {
    const store = readyStore()
    const page = [1, 2, 3].map(i => song(1000 + i, `歌曲 ${i}`))
    store.setPlaylist(page.slice(), 1)
    store.playSong(page[1], 1)
    store.playAfterCurrent(song(1002, '歌曲 2'))
    expect(store.audio.playlist.map(s => s.id)).toEqual([1001, 1002, 1003])
    expect(store.audio.currentIndex).toBe(1)
  })

  it('MobileSongList 队列上下文点击(playByIndex):仅切换当前曲目,队列保持不变', () => {
    const store = readyStore()
    const page = [1, 2, 3].map(i => song(1000 + i, `歌曲 ${i}`))
    store.setPlaylist(page.slice(), 0)
    store.playSong(page[0], 0)
    store.playByIndex(2)
    expect(store.audio.currentSong?.id).toBe(1003)
    expect(store.audio.playlist).toHaveLength(3)
    expect(store.audio.currentIndex).toBe(2)
  })

  it('组合流程:单击行播放 → 插播 → 队列点击 → 再插播(索引全程正确)', () => {
    const store = readyStore()
    // 1. 单击行播放:整页 5 首入队,从 index 1(1002)起播,当前曲目保留在队列
    const page = [1, 2, 3, 4, 5].map(i => song(1000 + i, `歌曲 ${i}`))
    store.setPlaylist(page.slice(), 1)
    store.playSong(page[1], 1)
    expect(store.audio.playlist).toHaveLength(5)
    // 2. 插播新歌到 1002 之后
    store.playAfterCurrent(song(2001, '插播 A'))
    expect(store.audio.playlist.map(s => s.id)).toEqual([1001, 1002, 2001, 1003, 1004, 1005])
    expect(store.audio.currentIndex).toBe(2)
    // 3. MobileSongList 队列上下文点击最后一项
    store.playByIndex(5)
    expect(store.audio.currentSong?.id).toBe(1005)
    expect(store.audio.currentIndex).toBe(5)
    // 4. 把位于 index 3 的 1003 插播到 1005 之后:原位置移除 → 索引 5→4,插入到 5
    store.playAfterCurrent(song(1003, '歌曲 3'))
    expect(store.audio.playlist.map(s => s.id)).toEqual([1001, 1002, 2001, 1004, 1005, 1003])
    expect(store.audio.currentIndex).toBe(5)
    expect(store.audio.currentSong?.id).toBe(1003)
    expect(store.audio.originalPlaylist.map(s => s.id)).toEqual(store.audio.playlist.map(s => s.id))
  })
})
