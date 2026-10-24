<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Button from '@/components/Ui/Button.vue'
import { useDialogA11y } from '@/composables/useDialogA11y'
import { useToastStore } from '@/stores/modules/toast'
import { deleteMusicDatabase } from '@/utils/indexedDB'

const { t } = useI18n()
const toastStore = useToastStore()

const confirmOpen = ref(false)
const isClearing = ref(false)
const dialogRef = ref<HTMLElement | null>(null)

const closeConfirm = () => {
  if (isClearing.value) return
  confirmOpen.value = false
}

useDialogA11y({
  isOpen: confirmOpen,
  containerRef: dialogRef,
  onClose: closeConfirm,
})

const clearAllLocalData = async () => {
  if (isClearing.value) return
  isClearing.value = true
  try {
    localStorage.clear()
    sessionStorage.clear()
  } catch {
    // 隐私模式等场景下存储可能不可用，继续尝试清理 IndexedDB
  }
  try {
    await deleteMusicDatabase()
  } catch {
    // 删除失败不阻塞页面重载，残留数据库会在下次访问时覆盖写入
  }
  toastStore.show({ message: t('components.settings.privacyCleared'), type: 'success' })
  setTimeout(() => window.location.reload(), 500)
}
</script>

<template>
  <section class="glass-card space-y-4 rounded-2xl p-5">
    <div class="flex items-center gap-3 border-b border-glass pb-4">
      <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-slate-500 to-blue-600">
        <span class="icon-[mdi--shield-lock-outline] h-5 w-5 text-[var(--glass-text-accent)]" />
      </div>
      <div>
        <h3 class="text-primary text-sm font-semibold">{{ t('components.settings.privacyTitle') }}</h3>
        <p class="text-primary/50 text-xs">{{ t('components.settings.privacyDesc') }}</p>
      </div>
    </div>

    <dl class="space-y-3 text-xs">
      <div class="flex gap-3">
        <dt class="text-primary/80 w-28 shrink-0 font-medium">
          {{ t('components.settings.privacyLocalStorageTitle') }}
        </dt>
        <dd class="text-primary/55 min-w-0 flex-1 leading-relaxed">
          {{ t('components.settings.privacyLocalStorageDesc') }}
        </dd>
      </div>
      <div class="flex gap-3">
        <dt class="text-primary/80 w-28 shrink-0 font-medium">
          {{ t('components.settings.privacyIndexedDbTitle') }}
        </dt>
        <dd class="text-primary/55 min-w-0 flex-1 leading-relaxed">
          {{ t('components.settings.privacyIndexedDbDesc') }}
        </dd>
      </div>
    </dl>

    <Button
      variant="ghost"
      size="sm"
      rounded="lg"
      class="min-h-11 border border-red-500/30 bg-red-500/10 px-4 text-xs font-semibold text-red-400 hover:bg-red-500/20"
      icon="icon-[mdi--delete-forever-outline]"
      icon-class="h-4 w-4"
      @click="confirmOpen = true"
    >
      {{ t('components.settings.privacyClear') }}
    </Button>
  </section>

  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="confirmOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-clear-dialog-title"
        @click.self="closeConfirm"
      >
        <div
          ref="dialogRef"
          tabindex="-1"
          class="w-full max-w-sm rounded-2xl border border-glass bg-[var(--glass-bg-overlay)] p-6 text-primary shadow-[var(--glass-shadow-xl)] outline-none"
          @click.stop
        >
          <div class="flex items-center gap-3">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/15 text-red-400">
              <span class="icon-[mdi--alert-circle-outline] h-5 w-5"></span>
            </div>
            <div class="min-w-0">
              <h3 id="privacy-clear-dialog-title" class="text-base font-semibold text-primary">
                {{ t('components.settings.privacyClearConfirmTitle') }}
              </h3>
              <p class="mt-1 text-xs font-medium leading-relaxed text-primary/70">
                {{ t('components.settings.privacyClearConfirmDesc') }}
              </p>
            </div>
          </div>

          <div class="mt-6 flex items-center justify-end gap-3">
            <Button
              variant="soft"
              size="sm"
              rounded="xl"
              class="min-h-11 px-4 text-xs font-medium text-primary/70 hover:bg-hover-glass hover:text-primary"
              :disabled="isClearing"
              @click="closeConfirm"
            >
              {{ t('common.cancel') }}
            </Button>
            <Button
              variant="soft"
              size="sm"
              rounded="xl"
              class="min-h-11 border border-red-500/40 bg-red-500/20 px-4 text-xs font-semibold text-red-300 hover:bg-red-500/30"
              :loading="isClearing"
              @click="clearAllLocalData"
            >
              {{ t('components.settings.privacyClearConfirmAction') }}
            </Button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
