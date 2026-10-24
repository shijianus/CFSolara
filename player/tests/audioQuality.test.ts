import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAudioStore } from '@/stores/modules/audio'
import type { Song } from '@/stores/interface'

type Listener = (event: Event) => void

class FakeAudio {
  src = ''
  currentTime = 0
  duration = 200
  error: MediaError | null = null
  private listeners: Record<string, Listener[]> = {}

  constructor(private shouldFail = false) {}

  getAttribute(name: string) {
    return name === 'src' ? this.src : null
  }

  addEventListener(event: string, cb: Listener) {
    this.listeners[event] = this.listeners[event] || []
    this.listeners[event].push(cb)
  }

  removeEventListener(event: string, cb: Listener) {
    this.listeners[event] = (this.listeners[event] || []).filter(fn => fn !== cb)
  }

  load() {
    setTimeout(() => {
      if (this.shouldFail) {
        this.error = { code: 4, message: 'MEDIA_ERR_SRC_NOT_SUPPORTED' } as MediaError
        ;(this.listeners.error || []).forEach(cb => cb(new Event('error')))
      } else {
        ;(this.listeners.loadedmetadata || []).forEach(cb => cb(new Event('loadedmetadata')))
      }
    }, 0)
  }

  play() {
    if (this.shouldFail) return Promise.reject(new Error('source unavailable'))
    return Promise.resolve()
  }

  pause() {}
}

const makeSong = (streamUrl: string): Song => ({
  id: 1,
  name: 'A',
  artist: 'B',
  duration: 200000,
  url: 'old.mp3',
  qualityBadge: 'SQ',
  qualities: [
    { level: 'lossless', label: 'SQ', bitrate: 'FLAC', streamUrl: 'old.mp3' },
    { level: 'exhigh', label: 'HQ', bitrate: '320kbps', streamUrl },
  ],
})

const setupStore = (shouldFail: boolean) => {
  const store = useAudioStore()
  const fakeAudio = new FakeAudio(shouldFail)
  const song = makeSong(shouldFail ? 'new-fail.mp3' : 'new-ok.mp3')
  store.audio.audio = fakeAudio as unknown as HTMLAudioElement
  store.audio.currentSong = song
  store.audio.playlist = [song]
  store.audio.originalPlaylist = [song]
  store.audio.currentIndex = 0
  store.audio.isPlaying = false
  return { store, song, fakeAudio }
}

describe('switchQuality', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('新音源可用时提交 URL 与徽章', async () => {
    const { store, song, fakeAudio } = setupStore(false)
    fakeAudio.currentTime = 12

    await store.switchQuality('exhigh')

    expect(song.url).toBe('new-ok.mp3')
    expect(song.qualityBadge).toBe('HQ')
    expect(store.audio.playlist[0].url).toBe('new-ok.mp3')
    expect(store.audio.playlist[0].qualityBadge).toBe('HQ')
    expect(store.audio.audio?.currentTime).toBe(12)
    expect(store.audio.isLoading).toBe(false)
  })

  it('新音源失败时回滚 URL、徽章并向上抛出', async () => {
    const { store, song } = setupStore(true)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(store.switchQuality('exhigh')).rejects.toBeTruthy()

    expect(song.url).toBe('old.mp3')
    expect(song.qualityBadge).toBe('SQ')
    expect(store.audio.playlist[0].url).toBe('old.mp3')
    expect(store.audio.playlist[0].qualityBadge).toBe('SQ')
    expect(store.audio.isLoading).toBe(false)
    errorSpy.mockRestore()
  })
})
