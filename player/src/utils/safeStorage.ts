/**
 * 安全存储适配器
 * 浏览器禁用 Cookie/站点数据、处于沙箱 iframe 或隐私模式时，
 * 访问 window.localStorage 会抛 SecurityError。此处统一降级到内存存储，
 * 保证应用能够正常启动（仅失去跨刷新持久化能力）。
 */

const memory = new Map<string, string>()

function detectBackend(): Storage | null {
  try {
    const storage = window.localStorage
    const probe = '__sonic_storage_probe__'
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}

const backend = typeof window === 'undefined' ? null : detectBackend()

export const safeStorage = {
  getItem(key: string): string | null {
    try {
      return backend ? backend.getItem(key) : (memory.get(key) ?? null)
    } catch {
      return memory.get(key) ?? null
    }
  },
  setItem(key: string, value: string): void {
    try {
      if (backend) backend.setItem(key, value)
      else memory.set(key, value)
    } catch {
      memory.set(key, value)
    }
  },
  removeItem(key: string): void {
    try {
      if (backend) backend.removeItem(key)
      else memory.delete(key)
    } catch {
      memory.delete(key)
    }
  },
  clear(): void {
    try {
      if (backend) backend.clear()
      else memory.clear()
    } catch {
      memory.clear()
    }
  },
} as Storage

export default safeStorage
