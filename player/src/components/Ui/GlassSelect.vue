<template>
  <div class="relative w-full rounded-xl" ref="rootRef">
    <button
      ref="triggerRef"
      type="button"
      class="glass-button text-primary flex w-full h-[36px] items-center justify-between overflow-hidden rounded-xl px-3 text-left text-[13px] font-medium"
      @click="toggle"
    >
      <span class="truncate text-[13px] font-medium text-primary">{{ selectedLabel }}</span>
      <span
        class="icon-[mdi--chevron-down] text-primary/70 h-4 w-4 shrink-0 transition"
        :class="{ 'rotate-180': open }"
      ></span>
    </button>

    <Teleport to="body">
      <transition name="fade" mode="out-in">
        <div
          v-if="open"
          ref="dropdownRef"
          class="glass-dropdown fixed z-99999 overflow-hidden rounded-xl shadow-lg backdrop-blur-md backdrop-filter border border-white/10"
          :style="dropdownStyle"
        >
          <ul class="max-h-60 overflow-auto py-1">
            <li
              v-for="opt in options"
              :key="String(opt.value)"
              class="option-item cursor-pointer rounded-lg px-3 py-2 text-[13px] font-medium transition"
              :class="{ selected: opt.value === modelValue }"
              @click="select(opt.value)"
              @mouseenter="emit('hover-option', opt.value)"
            >
              {{ opt.label }}
            </li>
          </ul>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
interface OptionItem {
  label: string
  value: any
}
const props = defineProps<{ modelValue: any; options: OptionItem[] }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: any): void
  (e: 'hover-option', v: any): void
}>()
const state = reactive({
  open: false,
})
const { open } = toRefs(state)
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)
const dropdownRef = ref<HTMLElement | null>(null)

const dropdownStyle = ref<{ top: string; left: string; width: string }>({
  top: '0px',
  left: '0px',
  width: '0px',
})

const updatePosition = () => {
  if (!triggerRef.value) return
  const rect = triggerRef.value.getBoundingClientRect()
  dropdownStyle.value = {
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
  }
}

const selectedLabel = computed(
  () => props.options.find(o => o.value === props.modelValue)?.label ?? ''
)
const toggle = () => {
  if (!state.open) updatePosition()
  state.open = !state.open
}
const select = (v: string | number) => {
  emit('update:modelValue', v)
  state.open = false
}
const onClickOutside = (e: MouseEvent) => {
  const root = rootRef.value
  const dropdown = dropdownRef.value
  if (!root) return
  const target = e.target as Node
  if (!root.contains(target) && !dropdown?.contains(target)) {
    state.open = false
  }
}
onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.option-item {
  color: var(--glass-text-contrast);
}
.option-item:hover {
  background: var(--glass-interactive-hover-muted);
}
.option-item.selected {
  background: var(--glass-interactive-hover-muted);
  color: var(--glass-interactive-text-hover);
}
</style>
