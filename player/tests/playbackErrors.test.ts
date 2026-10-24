import { describe, it, expect } from 'vitest'
import { classifyPlaybackError } from '@/stores/modules/audio'

const mediaError = (code: number) => ({ code }) as MediaError

describe('播放错误分类', () => {
  it('网络错误归为 network', () => {
    expect(classifyPlaybackError(mediaError(2))).toBe('network')
    expect(classifyPlaybackError(new Error('network timeout'))).toBe('network')
  })

  it('解码/媒体源解析失败归为 source', () => {
    expect(classifyPlaybackError(mediaError(3))).toBe('source')
  })

  it('源不支持或 403/404 归为版权受限', () => {
    expect(classifyPlaybackError(mediaError(4))).toBe('copyright')
    expect(classifyPlaybackError(new Error('HTTP 403'))).toBe('copyright')
    expect(classifyPlaybackError(new Error('copyright restricted'))).toBe('copyright')
  })
})
