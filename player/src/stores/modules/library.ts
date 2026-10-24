/**
 * 个人音乐库 Store
 * 本地持久化收藏歌单、关注歌手、喜欢歌曲与 MV 点赞
 * 无后端写接口，全部状态落 localStorage，刷新后保留
 */
import { defineStore } from 'pinia'
import type { Song } from '../interface'
import piniaPersistConfig from '../persist'

export interface LikedSongItem {
  id: string | number
  name: string
  artist: string
  album?: string
  cover?: string
  duration?: number
  mvId?: string | number
  likedAt: number
}

export interface CollectedPlaylistItem {
  id: string | number
  name: string
  coverImgUrl?: string
  trackCount?: number
  creator?: string
  playCount?: number | string
  collectedAt: number
}

export interface FollowedArtistItem {
  id: string | number
  name: string
  picUrl?: string
  followedAt: number
}

export interface CollectedAlbumItem {
  id: string | number
  name: string
  picUrl?: string
  artist?: string
  artistId?: string | number
  trackCount?: number
  collectedAt: number
}

export interface LikedMvItem {
  id: string | number
  name: string
  artist?: string
  cover?: string
  likedAt: number
}

/** 本地歌单(无后端写接口,歌曲与歌单关系全部落 localStorage) */
export interface UserPlaylistItem {
  id: string
  name: string
  createdAt: number
  songs: LikedSongItem[]
}

interface LibraryState {
  likedSongs: LikedSongItem[]
  collectedPlaylists: CollectedPlaylistItem[]
  followedArtists: FollowedArtistItem[]
  likedMvs: LikedMvItem[]
  collectedAlbums: CollectedAlbumItem[]
  userPlaylists: UserPlaylistItem[]
}

const sameId = (a: string | number | undefined, b: string | number | undefined) =>
  a !== undefined && b !== undefined && String(a) === String(b)

export const useLibraryStore = defineStore('library', {
  state: (): LibraryState => ({
    likedSongs: [],
    collectedPlaylists: [],
    followedArtists: [],
    likedMvs: [],
    collectedAlbums: [],
    userPlaylists: [],
  }),

  getters: {
    likedSongCount: (state: LibraryState) => state.likedSongs.length,
    collectedPlaylistCount: (state: LibraryState) => state.collectedPlaylists.length,
    followedArtistCount: (state: LibraryState) => state.followedArtists.length,
    likedMvCount: (state: LibraryState) => state.likedMvs.length,
    collectedAlbumCount: (state: LibraryState) => state.collectedAlbums.length,
  },

  actions: {
    // ---------- 喜欢歌曲 ----------
    isSongLiked(id: string | number | undefined): boolean {
      return this.likedSongs.some((s: LikedSongItem) => sameId(s.id, id))
    },

    toggleLikeSong(song: Partial<Song> & { id: string | number }): boolean {
      const idx = this.likedSongs.findIndex((s: LikedSongItem) => sameId(s.id, song.id))
      if (idx !== -1) {
        this.likedSongs.splice(idx, 1)
        return false
      }
      this.likedSongs.unshift({
        id: song.id,
        name: song.name || '',
        artist: song.artist || '',
        album: song.album,
        cover: song.cover,
        duration: song.duration,
        mvId: song.mvId,
        likedAt: Date.now(),
      })
      return true
    },

    removeLikedSong(id: string | number) {
      this.likedSongs = this.likedSongs.filter((s: LikedSongItem) => !sameId(s.id, id))
    },

    /** 喜欢的歌曲映射为 Store 层 Song，可直接入队播放 */
    toPlayableSongs(): Song[] {
      return this.likedSongs.map((s: LikedSongItem) => ({
        id: s.id,
        name: s.name,
        artist: s.artist,
        album: s.album,
        cover: s.cover,
        duration: s.duration || 0,
        mvId: s.mvId,
        liked: true,
      }))
    },

    // ---------- 收藏歌单 ----------
    isPlaylistCollected(id: string | number | undefined): boolean {
      return this.collectedPlaylists.some((p: CollectedPlaylistItem) => sameId(p.id, id))
    },

    toggleCollectPlaylist(playlist: {
      id: string | number
      name: string
      coverImgUrl?: string
      trackCount?: number
      creator?: string
      playCount?: number | string
    }): boolean {
      const idx = this.collectedPlaylists.findIndex((p: CollectedPlaylistItem) => sameId(p.id, playlist.id))
      if (idx !== -1) {
        this.collectedPlaylists.splice(idx, 1)
        return false
      }
      this.collectedPlaylists.unshift({
        id: playlist.id,
        name: playlist.name || '',
        coverImgUrl: playlist.coverImgUrl,
        trackCount: playlist.trackCount,
        creator: playlist.creator,
        playCount: playlist.playCount,
        collectedAt: Date.now(),
      })
      return true
    },

    removeCollectedPlaylist(id: string | number) {
      this.collectedPlaylists = this.collectedPlaylists.filter((p: CollectedPlaylistItem) => !sameId(p.id, id))
    },

    // ---------- 关注歌手 ----------
    isArtistFollowed(id: string | number | undefined): boolean {
      return this.followedArtists.some((a: FollowedArtistItem) => sameId(a.id, id))
    },

    toggleFollowArtist(artist: { id: string | number; name: string; picUrl?: string }): boolean {
      const idx = this.followedArtists.findIndex((a: FollowedArtistItem) => sameId(a.id, artist.id))
      if (idx !== -1) {
        this.followedArtists.splice(idx, 1)
        return false
      }
      this.followedArtists.unshift({
        id: artist.id,
        name: artist.name || '',
        picUrl: artist.picUrl,
        followedAt: Date.now(),
      })
      return true
    },

    removeFollowedArtist(id: string | number) {
      this.followedArtists = this.followedArtists.filter((a: FollowedArtistItem) => !sameId(a.id, id))
    },

    // ---------- MV 点赞 ----------
    isMvLiked(id: string | number | undefined): boolean {
      return this.likedMvs.some((m: LikedMvItem) => sameId(m.id, id))
    },

    toggleLikeMv(mv: { id: string | number; name: string; artist?: string; cover?: string }): boolean {
      const idx = this.likedMvs.findIndex((m: LikedMvItem) => sameId(m.id, mv.id))
      if (idx !== -1) {
        this.likedMvs.splice(idx, 1)
        return false
      }
      this.likedMvs.unshift({
        id: mv.id,
        name: mv.name || '',
        artist: mv.artist,
        cover: mv.cover,
        likedAt: Date.now(),
      })
      return true
    },

    removeLikedMv(id: string | number) {
      this.likedMvs = this.likedMvs.filter((m: LikedMvItem) => !sameId(m.id, id))
    },

    // ---------- 收藏专辑 ----------
    isAlbumCollected(id: string | number | undefined): boolean {
      return this.collectedAlbums.some((a: CollectedAlbumItem) => sameId(a.id, id))
    },

    toggleCollectAlbum(album: {
      id: string | number
      name: string
      picUrl?: string
      artist?: string
      artistId?: string | number
      trackCount?: number
    }): boolean {
      const idx = this.collectedAlbums.findIndex((a: CollectedAlbumItem) => sameId(a.id, album.id))
      if (idx !== -1) {
        this.collectedAlbums.splice(idx, 1)
        return false
      }
      this.collectedAlbums.unshift({
        id: album.id,
        name: album.name || '',
        picUrl: album.picUrl,
        artist: album.artist,
        artistId: album.artistId,
        trackCount: album.trackCount,
        collectedAt: Date.now(),
      })
      return true
    },

    removeCollectedAlbum(id: string | number) {
      this.collectedAlbums = this.collectedAlbums.filter((a: CollectedAlbumItem) => !sameId(a.id, id))
    },

    // ---------- 本地歌单 ----------
    createUserPlaylist(name: string): UserPlaylistItem | null {
      const trimmed = name.trim()
      if (!trimmed) return null
      const item: UserPlaylistItem = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: trimmed,
        createdAt: Date.now(),
        songs: [],
      }
      this.userPlaylists.unshift(item)
      return item
    },

    removeUserPlaylist(id: string) {
      this.userPlaylists = this.userPlaylists.filter((p: UserPlaylistItem) => p.id !== id)
    },

    renameUserPlaylist(id: string, name: string) {
      const trimmed = name.trim()
      const pl = this.userPlaylists.find((p: UserPlaylistItem) => p.id === id)
      if (pl && trimmed) pl.name = trimmed
    },

    isSongInUserPlaylist(playlistId: string, songId: string | number | undefined): boolean {
      const pl = this.userPlaylists.find((p: UserPlaylistItem) => p.id === playlistId)
      return Boolean(pl?.songs.some((s: LikedSongItem) => sameId(s.id, songId)))
    },

    /** 加入本地歌单;返回是否真正写入(已存在时为 false) */
    addSongToUserPlaylist(
      playlistId: string,
      song: Partial<Song> & { id: string | number }
    ): boolean {
      const pl = this.userPlaylists.find((p: UserPlaylistItem) => p.id === playlistId)
      if (!pl) return false
      if (pl.songs.some((s: LikedSongItem) => sameId(s.id, song.id))) return false
      pl.songs.unshift({
        id: song.id,
        name: song.name || '',
        artist: song.artist || '',
        album: song.album,
        cover: song.cover,
        duration: song.duration,
        mvId: song.mvId,
        likedAt: Date.now(),
      })
      return true
    },

    removeSongFromUserPlaylist(playlistId: string, songId: string | number) {
      const pl = this.userPlaylists.find((p: UserPlaylistItem) => p.id === playlistId)
      if (!pl) return
      pl.songs = pl.songs.filter((s: LikedSongItem) => !sameId(s.id, songId))
    },

    /** 本地歌单映射为 Store 层 Song,可直接入队播放 */
    toPlayableSongsForUserPlaylist(playlistId: string): Song[] {
      const pl = this.userPlaylists.find((p: UserPlaylistItem) => p.id === playlistId)
      if (!pl) return []
      return pl.songs.map((s: LikedSongItem) => ({
        id: s.id,
        name: s.name,
        artist: s.artist,
        album: s.album,
        cover: s.cover,
        duration: s.duration || 0,
        mvId: s.mvId,
      }))
    },
  },

  persist: piniaPersistConfig<LibraryState>('library', [
    'likedSongs',
    'collectedPlaylists',
    'followedArtists',
    'likedMvs',
    'collectedAlbums',
    'userPlaylists',
  ]),
})
