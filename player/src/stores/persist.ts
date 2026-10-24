/**
 * Pinia 持久化配置
 * 基于 pinia-plugin-persistedstate，将指定的 state 字段存储到 localStorage
 */
import type { StateTree } from 'pinia'
import type { PersistenceOptions } from 'pinia-plugin-persistedstate'
import { safeStorage } from '@/utils/safeStorage'

/**
 * 生成 Pinia Store 的持久化配置
 * @param key - 存储到 localStorage 的键名
 * @param paths - 需要持久化的 state 路径列表（如 ['audio.volume', 'audio.playMode']）
 * @returns PersistenceOptions 配置对象
 */
const piniaPersistConfig = <S extends StateTree = StateTree>(key: string, paths?: string[]): PersistenceOptions<S> => {
  const persist: PersistenceOptions<S> = {
    key,
    storage: safeStorage,
    pick: paths,
  }
  return persist
}

export default piniaPersistConfig
