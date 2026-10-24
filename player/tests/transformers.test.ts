import { describe, it, expect } from 'vitest'
import { transformSong, normalizeDurationMs } from '@/utils/transformers'
import { formatDuration, formatDurationOrDash } from '@/utils/time'

describe('normalizeDurationMs', () => {
  it('毫秒输入原样保留', () => {
    expect(normalizeDurationMs(185000)).toBe(185000)
    expect(normalizeDurationMs(3600000)).toBe(3600000)
  })

  it('秒级输入（< 3600）换算为毫秒', () => {
    expect(normalizeDurationMs(185)).toBe(185000)
    expect(normalizeDurationMs(59)).toBe(59000)
    expect(normalizeDurationMs(3599)).toBe(3599000)
  })

  it('非法输入归零', () => {
    expect(normalizeDurationMs(0)).toBe(0)
    expect(normalizeDurationMs(-5)).toBe(-5)
    expect(normalizeDurationMs(undefined)).toBe(0)
    expect(normalizeDurationMs('abc')).toBe(0)
  })
})

describe('transformSong 时长单位', () => {
  it('dt 字段为毫秒时原样输出（NetEase 歌单/详情接口）', () => {
    const song = transformSong({ id: 1, name: 'A', dt: 221000, ar: [{ id: 9, name: 'X' }] })
    expect(song.duration).toBe(221000)
    expect(formatDuration(song.duration)).toBe('3:41')
  })

  it('duration 字段为秒时换算为毫秒（nexus 搜索网关等秒级数据源）', () => {
    const song = transformSong({ id: 2, name: 'B', duration: 221, artists: [{ id: 8, name: 'Y' }] })
    expect(song.duration).toBe(221000)
    expect(formatDuration(song.duration)).toBe('3:41')
  })

  it('duration 字段为毫秒时不重复换算', () => {
    const song = transformSong({ id: 3, name: 'C', duration: 221000 })
    expect(song.duration).toBe(221000)
  })

  it('缺失时长输出 0，展示层使用占位符', () => {
    const song = transformSong({ id: 4, name: 'D' })
    expect(song.duration).toBe(0)
    expect(formatDurationOrDash(song.duration)).toBe('--:--')
  })
})
