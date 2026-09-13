<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { TerminalIcon } from '@lucide/vue'

import appIcon from '@/assets/app-icon.png'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { LEVEL_CLASS, STATUS_META, type BackendStatus, type LogLine } from '@/lib/splash'

const props = defineProps<{
  logs: LogLine[]
  status: BackendStatus
}>()

const bottomRef = ref<HTMLDivElement | null>(null)

// 新日志到达时自动滚动到底部
watch(
  () => props.logs,
  async () => {
    await nextTick()
    bottomRef.value?.scrollIntoView({ block: 'end' })
  },
)

const meta = computed(() => STATUS_META[props.status])
</script>

<template>
  <Card class="flex h-full w-full max-w-3xl flex-col">
    <CardHeader>
      <div class="flex items-center gap-3">
        <img
          :src="appIcon"
          alt="DSH Desktop"
          class="size-11 shrink-0 rounded-lg ring-1 ring-border"
        />
        <div class="flex min-w-0 flex-col gap-0.5">
          <CardTitle>DSH Desktop</CardTitle>
          <CardDescription>DeepSeek Harness 桌面版</CardDescription>
        </div>
      </div>
    </CardHeader>

    <CardContent class="flex min-h-0 flex-1 flex-col gap-4">
      <div class="flex items-center gap-3">
        <Badge :variant="meta.variant">
          <component
            :is="meta.icon"
            data-icon="inline-start"
            :class="cn(status === 'starting' && 'animate-spin')"
          />
          {{ meta.label }}
        </Badge>
        <span class="text-xs text-muted-foreground">
          {{ status === 'ready' ? '后端已就绪，日志会持续输出' : '后端启动后窗口将自动跳转' }}
        </span>
      </div>

      <Separator />

      <div class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <TerminalIcon class="size-3.5" />
        启动日志
      </div>

      <ScrollArea
        class="min-h-0 flex-1 rounded-lg border border-border bg-muted/30 font-mono text-xs"
      >
        <div class="flex flex-col gap-1 p-3">
          <p v-if="logs.length === 0" class="italic text-muted-foreground">等待日志输出…</p>
          <template v-else>
            <div v-for="line in logs" :key="line.id" class="flex gap-2">
              <span class="shrink-0 text-muted-foreground/60">[{{ line.time }}]</span>
              <span :class="cn('min-w-0 break-all whitespace-pre-wrap', LEVEL_CLASS[line.level])">
                {{ line.text }}
              </span>
            </div>
          </template>
          <div ref="bottomRef" />
        </div>
      </ScrollArea>
    </CardContent>
  </Card>
</template>
