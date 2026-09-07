<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { LoaderCircleIcon, PowerIcon, RefreshCwIcon } from '@lucide/vue'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { errMessage } from '@/lib/splash'
import { cn } from '@/lib/utils'
import { UPDATE_META, updateHint, type UpdateState } from '@/lib/update'

const st = ref<UpdateState>({
  phase: 'idle',
  currentVersion: '',
  latestVersion: null,
  releaseNotes: null,
  percent: 0,
  error: null,
})

let unlisten: (() => void) | undefined

const meta = computed(() => UPDATE_META[st.value.phase])
const busy = computed(() => st.value.phase === 'checking' || st.value.phase === 'downloading')
const canInstall = computed(() => st.value.phase === 'downloaded')
const hasNewer = computed(
  () => !!st.value.latestVersion && st.value.latestVersion !== st.value.currentVersion,
)
const hint = computed(() => updateHint(st.value))

onMounted(async () => {
  try {
    st.value = await window.api.getUpdateState()
  } catch {
    // 拉取状态失败不影响页面使用
  }
  unlisten = window.api.onUpdate((next) => {
    st.value = next
  })
})

onUnmounted(() => {
  unlisten?.()
})

async function check(): Promise<void> {
  try {
    st.value = await window.api.checkForUpdates()
  } catch (e) {
    st.value = { ...st.value, phase: 'error', error: errMessage(e) }
  }
}

async function install(): Promise<void> {
  try {
    await window.api.installUpdate()
  } catch (e) {
    st.value = { ...st.value, phase: 'error', error: errMessage(e) }
  }
}
</script>

<template>
  <section class="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4">
    <div class="flex flex-wrap items-center gap-2 text-sm font-medium">
      <span>软件更新</span>
      <Badge variant="secondary">v{{ st.currentVersion || '—' }}</Badge>
      <Badge :variant="meta.variant">
        <component
          :is="meta.icon"
          data-icon="inline-start"
          :class="cn(busy && 'animate-spin')"
        />
        {{ meta.label }}
      </Badge>
      <Badge v-if="hasNewer" variant="outline">v{{ st.latestVersion }}</Badge>
    </div>

    <p class="text-sm text-muted-foreground">{{ hint }}</p>

    <div v-if="st.phase === 'downloading'" class="flex items-center gap-3">
      <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
        <div
          class="h-full rounded-full bg-primary transition-all"
          :style="{ width: `${st.percent}%` }"
        />
      </div>
      <span class="w-10 shrink-0 text-right text-xs text-muted-foreground">
        {{ st.percent }}%
      </span>
    </div>

    <ScrollArea v-if="st.releaseNotes" class="max-h-40 rounded-lg border border-border bg-muted/30">
      <div class="p-3">
        <pre class="whitespace-pre-wrap font-mono text-xs">{{ st.releaseNotes }}</pre>
      </div>
    </ScrollArea>

    <p v-if="st.error" class="text-sm text-destructive">{{ st.error }}</p>

    <div class="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" :disabled="busy" @click="check">
        <LoaderCircleIcon v-if="busy" data-icon="inline-start" class="animate-spin" />
        <RefreshCwIcon v-else data-icon="inline-start" />
        检查更新
      </Button>
      <Button v-if="canInstall" size="sm" @click="install">
        <PowerIcon data-icon="inline-start" />
        重启并安装
      </Button>
      <span v-if="canInstall" class="text-xs text-muted-foreground">
        也可直接退出应用，退出时会自动完成安装
      </span>
    </div>
  </section>
</template>
