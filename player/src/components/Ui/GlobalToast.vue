<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useToastStore, type ToastItem } from '@/stores/modules/toast'

const { t } = useI18n()
const toastStore = useToastStore()
const { toasts } = storeToRefs(toastStore)

const iconMap: Record<ToastItem['type'], string> = {
  info: 'icon-[mdi--information-outline]',
  success: 'icon-[mdi--check-circle-outline]',
  warning: 'icon-[mdi--alert-outline]',
  error: 'icon-[mdi--alert-circle-outline]',
}

const accentMap: Record<ToastItem['type'], string> = {
  info: 'border-sky-500/35',
  success: 'border-emerald-500/35',
  warning: 'border-amber-500/35',
  error: 'border-red-500/40',
}

const iconColorMap: Record<ToastItem['type'], string> = {
  info: 'text-sky-400',
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  error: 'text-red-400',
}

const runAction = async (toast: ToastItem, handler: () => void | Promise<void>) => {
  try {
    await handler()
  } catch (error) {
    console.error('[Toast] action failed:', error)
  } finally {
    toastStore.dismiss(toast.id)
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="pointer-events-none fixed inset-x-0 top-4 z-[70000] flex flex-col items-center gap-2 px-4"
      aria-live="polite"
      aria-atomic="false"
    >
      <TransitionGroup name="toast" tag="div" class="flex w-full flex-col items-center gap-2">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          :role="toast.type === 'error' ? 'alert' : 'status'"
          class="pointer-events-auto flex w-full max-w-[580px] items-start gap-3 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl"
          :class="accentMap[toast.type]"
          style="background: var(--glass-bg-overlay)"
        >
          <span
            class="mt-0.5 h-5 w-5 shrink-0"
            :class="[iconMap[toast.type], iconColorMap[toast.type]]"
            aria-hidden="true"
          ></span>
          <p class="text-primary min-w-0 flex-1 text-sm leading-relaxed">{{ toast.message }}</p>
          <div class="flex shrink-0 items-center gap-1">
            <button
              v-for="(action, index) in toast.actions"
              :key="`${toast.id}-${index}`"
              type="button"
              class="min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
              :class="action.primary ? 'text-sky-400 hover:bg-sky-500/10' : 'text-primary/70 hover:text-primary hover:bg-hover-glass'"
              @click="runAction(toast, action.handler)"
            >
              {{ action.label }}
            </button>
            <button
              type="button"
              class="text-primary/50 hover:text-primary hover:bg-hover-glass flex h-11 w-11 items-center justify-center rounded-xl transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
              :aria-label="t('common.close')"
              :title="t('common.close')"
              @click="toastStore.dismiss(toast.id)"
            >
              <span class="icon-[mdi--close] h-4 w-4"></span>
            </button>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: opacity 0.05s linear;
  }
  .toast-enter-from,
  .toast-leave-to {
    transform: none;
  }
}
</style>
