import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  delete: vi.fn(),
  getAll: vi.fn(),
}))

vi.mock('@/utils/indexedDB', () => ({
  localMusicDB: { add: mocks.add, delete: mocks.delete, getAll: mocks.getAll },
  downloadedMusicDB: { add: vi.fn(), delete: vi.fn(), getAll: vi.fn() },
}))

import { useLocalMusicStore } from '@/stores/modules/localMusic'

const makeMusic = (id: string) => ({
  id,
  name: `本地歌曲 ${id}`,
  artist: '测试歌手',
  album: '',
  duration: 30,
  cover: '',
  file: new Blob(['wav'], { type: 'audio/wav' }),
  createTime: Date.now(),
})

describe('本地音乐删除撤销', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.add.mockReset()
    mocks.delete.mockReset()
  })

  it('删除后撤销会写回 IndexedDB 并恢复到原位置', async () => {
    const store = useLocalMusicStore()
    const first = makeMusic('local_1')
    const second = makeMusic('local_2')
    store.musics = [first, second] as never

    await store.deleteMusic('local_1')
    expect(store.musics.map(m => m.id)).toEqual(['local_2'])
    expect(mocks.delete).toHaveBeenCalledWith('local_1')

    await store.restoreMusic(first as never, 0)
    expect(store.musics.map(m => m.id)).toEqual(['local_1', 'local_2'])
    expect(mocks.add).toHaveBeenCalledWith(first)
  })
})
