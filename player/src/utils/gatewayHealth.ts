import { reactive } from 'vue'

export type GatewayStatusKind = 'normal' | 'degraded' | 'stream-degraded-fail' | 'track-fail'

export const gatewayHealth = reactive({
  degraded: false,
  circuitState: 'CLOSED' as string,
  statusKind: 'normal' as GatewayStatusKind,
  message: '' as string,
  dismissedAt: 0,
})

export function inspectGatewayHeaders(
  headers?: Record<string, any> | Headers | null,
  body?: any,
): void {
  const getH = (name: string): string => {
    if (!headers) return ''
    if (typeof (headers as Headers).get === 'function') {
      return (headers as Headers).get(name) || ''
    }
    const lower = name.toLowerCase()
    return String((headers as Record<string, any>)[lower] ?? (headers as Record<string, any>)[name] ?? '')
  }

  const degradedHeader = getH('x-sonic-degraded')
  const viaHeader = getH('x-sonic-via')
  const circuitHeader = getH('x-sonic-circuit')
  if (circuitHeader) {
    gatewayHealth.circuitState = circuitHeader
  }

  const bodyDegraded = Boolean(body?.degraded || body?.meta?.degraded)

  if (degradedHeader === '1' || bodyDegraded) {
    gatewayHealth.degraded = true
    if (gatewayHealth.statusKind !== 'stream-degraded-fail') {
      gatewayHealth.statusKind = 'degraded'
      gatewayHealth.message = '边缘降级模式 · 本地解析引擎重连中，当前由 Cloudflare 边缘提供检索与歌词'
    }
  } else if (viaHeader === 'local-engine' || degradedHeader === '0') {
    gatewayHealth.degraded = false
    gatewayHealth.statusKind = 'normal'
    gatewayHealth.message = ''
  }
}

export function markStreamFailure(kind: 'stream-degraded-fail' | 'track-fail', customMsg?: string): void {
  if (kind === 'stream-degraded-fail') {
    gatewayHealth.degraded = true
    gatewayHealth.statusKind = 'stream-degraded-fail'
    gatewayHealth.message =
      customMsg || '服务降级受限 · 本地音频引擎离线，边缘节点无法解析该曲直链（歌词与缓存仍可用）'
    gatewayHealth.dismissedAt = 0
  } else {
    gatewayHealth.statusKind = 'track-fail'
    gatewayHealth.message = customMsg || '当前曲目暂无可用音源或受版权限制'
    gatewayHealth.dismissedAt = 0
  }
}

export function dismissGatewayBanner(): void {
  gatewayHealth.dismissedAt = Date.now()
}
