<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CheckIcon, CopyIcon, LoaderCircleIcon, RefreshCwIcon, TerminalIcon } from '@lucide/vue'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { errMessage } from '@/lib/splash'
import { cn } from '@/lib/utils'
import {
  checkedAtText,
  DSH_PACKAGE,
  DSH_STATUS_META,
  DSH_UPGRADE_COMMAND,
  dshHint,
  type DshVersionState
} from '@/lib/dsh'

const st = ref<DshVersionState>({
  current: null,
  latest: null,
  status: 'unknown',
  checkedAt: null,
  error: null
})

/** 是否已经手动检查过（用于区分“尚未检查”与“检查后仍未知”）。 */
const everChecked = ref(false)
/** 复制命令后的短暂反馈。 */
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

const meta = computed(() => DSH_STATUS_META[st.value.status])
const busy = computed(() => st.value.status === 'checking')
const idle = computed(() => !everChecked.value && st.value.status === 'unknown')
const hint = computed(() => dshHint(st.value, idle.value))
const checkedAt = computed(() => checkedAtText(st.value.checkedAt))
const showUpgrade = computed(
  () => st.value.status === 'outdated' && !!st.value.latest && !busy.value
)

onMounted(async () => {
  try {
    st.value = await window.api.getDshVersion()
  } catch (e) {
    st.value = { ...st.value, status: 'error', error: errMessage(e) }
  }
})

async function check(): Promise<void> {
  everChecked.value = true
  st.value = { ...st.value, status: 'checking', error: null }
  try {
    st.value = await window.api.checkDshLatest()
  } catch (e) {
    st.value = { ...st.value, status: 'error', error: errMessage(e) }
  }
}

/** 复制升级命令；剪贴板 API 不可用时退回 textarea + execCommand。 */
async function copyCommand(): Promise<void> {
  let ok = false
  try {
    await navigator.clipboard.writeText(DSH_UPGRADE_COMMAND)
    ok = true
  } catch {
    try {
      const el = document.createElement('textarea')
      el.value = DSH_UPGRADE_COMMAND
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      ok = document.execCommand('copy')
      document.body.removeChild(el)
    } catch {
      ok = false
    }
  }
  if (!ok) return
  copied.value = true
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = false), 2000)
}
</script>

<template>
  <section class="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4">
    <div class="flex flex-wrap items-center gap-2 text-sm font-medium">
      <span>dsh 版本</span>
      <Badge variant="secondary">本机 v{{ st.current ?? '—' }}</Badge>
      <Badge :variant="meta.variant">
        <component :is="meta.icon" data-icon="inline-start" :class="cn(busy && 'animate-spin')" />
        {{ meta.label }}
      </Badge>
      <Badge v-if="st.latest && st.status === 'outdated'" variant="outline">
        npm v{{ st.latest }}
      </Badge>
    </div>

    <p class="text-sm text-muted-foreground">{{ hint }}</p>

    <p v-if="st.status === 'latest'" class="text-xs text-muted-foreground">
      npm 上的最新版本同样是 v{{ st.latest }}。
    </p>

    <div
      v-if="showUpgrade"
      class="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2"
    >
      <TerminalIcon class="size-3.5 shrink-0 text-muted-foreground" />
      <code class="min-w-0 flex-1 truncate font-mono text-xs">{{ DSH_UPGRADE_COMMAND }}</code>
      <Button size="xs" variant="ghost" @click="copyCommand">
        <component :is="copied ? CheckIcon : CopyIcon" data-icon="inline-start" />
        {{ copied ? '已复制' : '复制' }}
      </Button>
    </div>

    <p v-if="st.error" class="text-sm text-destructive">{{ st.error }}</p>

    <div class="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" :disabled="busy" @click="check">
        <LoaderCircleIcon v-if="busy" data-icon="inline-start" class="animate-spin" />
        <RefreshCwIcon v-else data-icon="inline-start" />
        检查最新版本
      </Button>
      <span class="text-xs text-muted-foreground">
        <template v-if="checkedAt">上次检查 {{ checkedAt }} · </template>
        通过 npm 查询 {{ DSH_PACKAGE }}，升级后需重启应用生效
      </span>
    </div>
  </section>
</template>
