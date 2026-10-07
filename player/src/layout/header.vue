<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

const router = useRouter()
const { t } = useI18n()
const state = reactive({
  searchQuery: '',
  showLogin: false,
  historyOpen: false,
  searchFocused: false,
})
const { searchQuery, showLogin, historyOpen, searchFocused } = toRefs(state)
const userStore = useUserStore()
const globalStore = useGlobalStore()
const { searchHistory, theme } = storeToRefs(globalStore)
const themeIcon = computed(() => {
  if (theme.value === 'system') return 'icon-[mdi--theme-light-dark]'
  if (theme.value === 'dark') return 'icon-[mdi--weather-night]'
  return 'icon-[mdi--weather-sunny]'
})
const cycleTheme = () => {
  const order: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system']
  const idx = order.indexOf(theme.value)
  globalStore.setTheme(order[(idx + 1) % 3])
}
const handleSearchEnter = () => {
  const q = state.searchQuery.trim()
  if (!q) return
  globalStore.addSearchHistory(q)
  state.historyOpen = false
  router.push({ path: '/search', query: { q } })
}
const openHistoryIfAny = () => {
  state.searchFocused = true
  if (searchHistory.value.length > 0) {
    updateDropdownPos()
    state.historyOpen = true
  }
}
const onSearchBlur = () => {
  state.searchFocused = false
}
const selectHistory = (q: string) => {
  state.searchQuery = q
  handleSearchEnter()
}
const clearSearch = () => {
  state.searchQuery = ''
  state.historyOpen = false
}
const rootRef = ref<HTMLElement | null>(null)
const dropdownRef = ref<HTMLElement | null>(null)
const dropdownStyle = ref({ top: '0px', left: '0px', width: '0px' })
const updateDropdownPos = () => {
  const el = rootRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  dropdownStyle.value = {
    top: `${rect.bottom + 8}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
  }
}
const onDocClick = (e: Event) => {
  const el = rootRef.value
  const dd = dropdownRef.value
  if (!el) return
  const target = e.target as Node
  if (el.contains(target)) return
  if (dd && dd.contains(target)) return
  state.historyOpen = false
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocClick)
})
onUnmounted(() => document.removeEventListener('pointerdown', onDocClick))
</script>
<template>
  <header class="glass-nav m-3 mx-4 flex items-center justify-between gap-4 px-4 py-4">
    <!-- 左侧：Logo + 导航 -->
    <div class="flex items-center gap-5">
      <!-- Logo -->
      <div class="flex items-center gap-3">
        <span class="relative flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#8b5cf6] via-[#ec4899] to-[#3b82f6] shadow-[0_0_16px_rgba(139,92,246,0.6)]">
          <span class="h-2.5 w-2.5 rounded-full bg-white/95"></span>
          <span class="absolute inset-0 rounded-full ring-1 ring-white/50"></span>
        </span>
        <h1 class="text-primary text-xl font-extrabold tracking-tight">Sonic</h1>
      </div>

      <!-- 前进/后退按钮组 -->
      <div
        class="border-glass-subtle hidden items-center overflow-hidden rounded-full border bg-white/5 md:flex"
      >
        <Button
          variant="ghost"
          size="none"
          rounded="none"
          class="border-glass-subtle h-8 w-8 justify-center border-r hover:bg-white/10"
          aria-label="back"
          @click="router.back()"
        >
          <span class="icon-[mdi--chevron-left] h-4.5 w-4.5"></span>
        </Button>
        <Button
          variant="ghost"
          size="none"
          rounded="none"
          class="h-8 w-8 justify-center hover:bg-white/10"
          aria-label="forward"
          @click="router.forward()"
        >
          <span class="icon-[mdi--chevron-right] h-4.5 w-4.5"></span>
        </Button>
      </div>
    </div>

    <!-- 右侧功能区 -->
    <div class="flex items-center gap-3">
      <!-- 搜索框 -->
      <div
        ref="rootRef"
        class="bg-button-glass hidden items-center gap-2.5 rounded-full px-4 py-2 transition-all duration-300 lg:flex shadow-sm"
        :class="[
          searchFocused
            ? 'border-glass min-w-80 border ring-2 ring-[#8b5cf6]/30 bg-white/10'
            : 'min-w-64 border border-white/10 hover:border-white/20',
        ]"
      >
        <span
          class="icon-[mdi--magnify] text-primary h-4 w-4 shrink-0 transition-opacity duration-200"
          :class="searchFocused || searchQuery ? 'opacity-65' : 'opacity-35'"
        ></span>
        <input
          v-model="searchQuery"
          @keyup.enter="handleSearchEnter"
          @focus="openHistoryIfAny"
          @blur="onSearchBlur"
          type="text"
          :placeholder="t('common.search.placeholder')"
          class="text-primary placeholder:text-primary/35 min-w-0 flex-1 bg-transparent text-[13px] font-[450] outline-none placeholder:font-normal"
        />
        <Transition name="fade-scale">
          <Button
            v-if="searchQuery"
            variant="ghost"
            size="none"
            rounded="lg"
            class="h-5.5 w-5.5 shrink-0 justify-center opacity-40 hover:opacity-70"
            :title="t('common.clear')"
            icon="icon-[mdi--close]"
            icon-class="h-3.5 w-3.5"
            @click="clearSearch"
          />
        </Transition>
      </div>

      <!-- 搜索历史下拉 -->
      <Teleport to="body">
        <Transition name="dropdown">
          <div
            v-if="historyOpen && searchHistory.length"
            ref="dropdownRef"
            class="glass-dropdown fixed z-99999 overflow-hidden rounded-2xl p-1 shadow-lg"
            :style="dropdownStyle"
          >
            <ul class="max-h-60 overflow-auto">
              <li
                v-for="opt in searchHistory"
                :key="opt"
                class="group text-glass-contrast hover:bg-hover-glass relative flex cursor-pointer items-center rounded-[10px] px-2.5 py-2 text-[13px] transition-colors"
                @mousedown.prevent="selectHistory(opt)"
              >
                <span class="icon-[mdi--history] mr-2.5 h-3.5 w-3.5 shrink-0 opacity-40"></span>
                <span class="truncate pr-6">{{ opt }}</span>
                <Button
                  variant="ghost"
                  size="none"
                  rounded="lg"
                  icon="icon-[mdi--close]"
                  icon-class="h-3.5 w-3.5 text-glass-contrast"
                  class="absolute top-1/2 right-2 h-5.5 w-5.5 -translate-y-1/2 justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-50 hover:opacity-80!"
                  :title="t('common.delete')"
                  @mousedown.stop.prevent="globalStore.removeSearchHistory(opt)"
                />
              </li>
            </ul>
          </div>
        </Transition>
      </Teleport>

      <!-- 主题切换 -->
      <Button
        variant="ghost"
        size="icon-md"
        rounded="lg"
        class="opacity-60 hover:opacity-100"
        :title="
          theme === 'system'
            ? t('components.settings.themeOptions.system')
            : theme === 'dark'
              ? t('components.settings.themeOptions.dark')
              : t('components.settings.themeOptions.light')
        "
        @click="cycleTheme"
      >
        <span :class="[themeIcon, 'h-[18px] w-[18px] transition-transform duration-300']"></span>
      </Button>

      <!-- 移动端菜单按钮 -->
      <Button variant="ghost" size="icon-md" rounded="lg" class="md:hidden">
        <span class="icon-[mdi--menu] text-primary h-5 w-5"></span>
      </Button>
    </div>
  </header>
</template>

<style scoped>
@reference "../style/tailwind.css";

/* 搜索清除按钮动画 */
.fade-scale-enter-active,
.fade-scale-leave-active {
  transition:
    opacity 0.15s,
    transform 0.15s;
}
.fade-scale-enter-from,
.fade-scale-leave-to {
  opacity: 0;
  transform: scale(0.8);
}

/* 历史下拉动画 */
.dropdown-enter-active {
  transition:
    opacity 0.2s,
    transform 0.2s;
}
.dropdown-leave-active {
  transition:
    opacity 0.15s,
    transform 0.15s;
}
.dropdown-enter-from {
  opacity: 0;
  transform: translateY(-6px) scale(0.97);
}
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
