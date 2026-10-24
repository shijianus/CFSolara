<script setup lang="ts">
import { useId } from 'vue'

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
const uid = useId()
const triggerId = `${uid}-trigger`
const listboxId = `${uid}-listbox`
const optionId = (index: number) => `${uid}-option-${index}`

const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const dropdownRef = ref<HTMLElement | null>(null)
const listboxRef = ref<HTMLElement | null>(null)
const optionRefs = ref<HTMLElement[]>([])
const activeIndex = ref(-1)

const selectedIndex = computed(() =>
  props.options.findIndex(o => o.value === props.modelValue)
)

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

const focusActiveOption = async () => {
  await nextTick()
  const option = optionRefs.value[activeIndex.value]
  if (option) option.focus()
  else listboxRef.value?.focus()
}

const openMenu = (startIndex = selectedIndex.value) => {
  if (open.value) return
  updatePosition()
  open.value = true
  activeIndex.value = startIndex >= 0 ? startIndex : 0
  focusActiveOption()
}

const closeMenu = (restoreFocus = true) => {
  if (!open.value) return
  open.value = false
  activeIndex.value = -1
  if (restoreFocus) {
    nextTick(() => triggerRef.value?.focus())
  }
}

const toggle = () => {
  if (open.value) closeMenu()
  else openMenu()
}

const select = (option: OptionItem) => {
  emit('update:modelValue', option.value)
  closeMenu()
}

const moveFocus = (delta: number) => {
  if (!props.options.length) return
  const base = activeIndex.value >= 0 ? activeIndex.value : 0
  activeIndex.value =
    (base + delta + props.options.length) % props.options.length
  emit('hover-option', props.options[activeIndex.value].value)
  focusActiveOption()
}

const handleTriggerKeydown = (event: KeyboardEvent) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!open.value) openMenu(selectedIndex.value >= 0 ? selectedIndex.value : 0)
    else moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    return
  }
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    closeMenu()
  }
}

const handleMenuKeydown = (event: KeyboardEvent) => {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      moveFocus(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      moveFocus(-1)
      break
    case 'Home':
      event.preventDefault()
      if (props.options.length) {
        activeIndex.value = 0
        emit('hover-option', props.options[0].value)
        focusActiveOption()
      }
      break
    case 'End':
      event.preventDefault()
      if (props.options.length) {
        activeIndex.value = props.options.length - 1
        emit('hover-option', props.options[activeIndex.value].value)
        focusActiveOption()
      }
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      if (activeIndex.value >= 0) select(props.options[activeIndex.value])
      break
    case 'Escape':
      event.preventDefault()
      event.stopPropagation()
      closeMenu()
      break
    case 'Tab':
      closeMenu(false)
      break
  }
}

const onClickOutside = (e: MouseEvent) => {
  const root = rootRef.value
  const dropdown = dropdownRef.value
  if (!root) return
  const target = e.target as Node
  if (!root.contains(target) && !dropdown?.contains(target)) {
    closeMenu(false)
  }
}
onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))
</script>

<template>
  <div class="relative w-full rounded-xl" ref="rootRef">
    <button
      :id="triggerId"
      ref="triggerRef"
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="listboxId"
      :aria-label="selectedLabel"
      class="glass-button text-primary flex w-full h-11 items-center justify-between overflow-hidden rounded-xl px-3 text-left text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
      @click="toggle"
      @keydown="handleTriggerKeydown"
    >
      <span class="truncate text-[13px] font-medium text-primary">{{ selectedLabel }}</span>
      <span
        class="icon-[mdi--chevron-down] text-primary/70 h-4 w-4 shrink-0 transition"
        :class="{ 'rotate-180': open }"
        aria-hidden="true"
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
          <ul
            :id="listboxId"
            ref="listboxRef"
            role="listbox"
            :aria-labelledby="triggerId"
            tabindex="-1"
            class="max-h-60 overflow-auto py-1 outline-none"
            @keydown="handleMenuKeydown"
          >
            <li
              v-for="(opt, index) in options"
              :id="optionId(index)"
              :key="String(opt.value)"
              :ref="(el) => { if (el) optionRefs[index] = el as HTMLElement }"
              role="option"
              :aria-selected="opt.value === modelValue"
              :tabindex="activeIndex === index ? 0 : -1"
              class="option-item cursor-pointer rounded-lg px-3 py-2 text-[13px] font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
              :class="{ selected: opt.value === modelValue }"
              @click="select(opt)"
              @mouseenter="emit('hover-option', opt.value)"
              @focus="activeIndex = index; emit('hover-option', opt.value)"
            >
              {{ opt.label }}
            </li>
          </ul>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

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
