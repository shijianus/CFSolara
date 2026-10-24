import { describe, it, expect, beforeEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { useLibraryStore } from '@/stores/modules/library'

describe('library store', () => {
  beforeEach(() => {
    localStorage.clear()
    const pinia = createPinia()
    pinia.use(piniaPluginPersistedstate)
    createApp({ render: () => null }).use(pinia)
    setActivePinia(pinia)
  })

  it('喜欢歌曲可切换且持久化字段完整', () => {
    const lib = useLibraryStore()
    expect(lib.isSongLiked(42)).toBe(false)

    expect(lib.toggleLikeSong({ id: 42, name: '晴天', artist: '周杰伦', duration: 269000 })).toBe(true)
    expect(lib.isSongLiked(42)).toBe(true)
    expect(lib.likedSongCount).toBe(1)
    expect(lib.likedSongs[0]).toMatchObject({ id: 42, name: '晴天', artist: '周杰伦' })
    expect(lib.likedSongs[0].likedAt).toBeGreaterThan(0)

    expect(lib.toggleLikeSong({ id: 42, name: '晴天', artist: '周杰伦' })).toBe(false)
    expect(lib.isSongLiked(42)).toBe(false)
    expect(lib.likedSongCount).toBe(0)
  })

  it('ID 使用字符串比较，数字与字符串等价', () => {
    const lib = useLibraryStore()
    lib.toggleLikeSong({ id: '100', name: 'A', artist: 'X' })
    expect(lib.isSongLiked(100)).toBe(true)
    expect(lib.isSongLiked('100')).toBe(true)
    lib.removeLikedSong(100)
    expect(lib.isSongLiked('100')).toBe(false)
  })

  it('收藏歌单与关注歌手互不干扰', () => {
    const lib = useLibraryStore()
    lib.toggleCollectPlaylist({ id: 3778678, name: '华语', trackCount: 50 })
    lib.toggleFollowArtist({ id: 6452, name: '周杰伦' })

    expect(lib.isPlaylistCollected(3778678)).toBe(true)
    expect(lib.isArtistFollowed(6452)).toBe(true)
    expect(lib.collectedPlaylistCount).toBe(1)
    expect(lib.followedArtistCount).toBe(1)

    lib.toggleFollowArtist({ id: 6452, name: '周杰伦' })
    expect(lib.isArtistFollowed(6452)).toBe(false)
    expect(lib.collectedPlaylistCount).toBe(1)
  })

  it('专辑收藏切换与移除', () => {
    const lib = useLibraryStore()
    lib.toggleCollectAlbum({ id: 9, name: '专辑 A', artist: '周杰伦' })
    expect(lib.isAlbumCollected(9)).toBe(true)
    lib.removeCollectedAlbum(9)
    expect(lib.collectedAlbumCount).toBe(0)
  })

  it('MV 点赞切换与移除', () => {
    const lib = useLibraryStore()
    lib.toggleLikeMv({ id: 'm1', name: 'MV A', artist: 'Y' })
    expect(lib.isMvLiked('m1')).toBe(true)
    lib.removeLikedMv('m1')
    expect(lib.likedMvCount).toBe(0)
  })

  it('toPlayableSongs 输出可直接播放的歌曲列表', () => {
    const lib = useLibraryStore()
    lib.toggleLikeSong({ id: 1, name: 'A', artist: 'X', duration: 100000, cover: 'c.jpg' })
    lib.toggleLikeSong({ id: 2, name: 'B', artist: 'Y' })
    const songs = lib.toPlayableSongs()
    expect(songs).toHaveLength(2)
    expect(songs[0]).toMatchObject({ id: 2, liked: true }) // 新喜欢的排前面
    expect(songs[1].duration).toBe(100000)
  })

  it('状态变更后写入 localStorage，重建 store 后保留（刷新持久化）', async () => {
    const lib = useLibraryStore()
    lib.toggleLikeSong({ id: 42, name: '晴天', artist: '周杰伦' })
    lib.toggleCollectPlaylist({ id: 1, name: '歌单 A' })
    lib.toggleFollowArtist({ id: 6452, name: '周杰伦' })
    lib.toggleLikeMv({ id: 'm1', name: 'MV A' })
    lib.toggleCollectAlbum({ id: 9, name: '专辑 A', artist: '周杰伦' })
    await nextTick()

    const raw = localStorage.getItem('library')
    expect(raw).toBeTruthy()
    const persisted = JSON.parse(raw as string)
    expect(persisted.likedSongs).toHaveLength(1)
    expect(persisted.collectedPlaylists).toHaveLength(1)
    expect(persisted.followedArtists).toHaveLength(1)
    expect(persisted.likedMvs).toHaveLength(1)
    expect(persisted.collectedAlbums).toHaveLength(1)

    // 模拟页面刷新：同一 storage 重建 pinia 与 store
    const pinia2 = createPinia()
    pinia2.use(piniaPluginPersistedstate)
    createApp({ render: () => null }).use(pinia2)
    setActivePinia(pinia2)
    const revived = useLibraryStore()
    expect(revived.isSongLiked(42)).toBe(true)
    expect(revived.isPlaylistCollected(1)).toBe(true)
    expect(revived.isArtistFollowed(6452)).toBe(true)
    expect(revived.isMvLiked('m1')).toBe(true)
    expect(revived.isAlbumCollected(9)).toBe(true)
  })
})
