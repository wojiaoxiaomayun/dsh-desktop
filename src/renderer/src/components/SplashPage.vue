<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  ArrowLeftIcon,
  SettingsIcon,
  SquareTerminalIcon,
  TerminalIcon,
} from '@lucide/vue'

import appIcon from '@/assets/app-icon.png'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
  inElectron: boolean
}>()

const emit = defineEmits<{
  (e: 'return'): void
  (e: 'open-settings'): void
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

function toggleDevtools(): void {
  void window.api.toggleDevtools()
}
</script>

<template>
  <Card class="w-full max-w-2xl">
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

    <CardContent class="flex flex-col gap-4">
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

      <ScrollArea class="h-72 rounded-lg border border-border bg-muted/30 font-mono text-xs">
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

    <CardFooter class="justify-center gap-3">
      <Button
        v-if="inElectron"
        size="sm"
        variant="outline"
        :disabled="status !== 'ready'"
        @click="emit('return')"
      >
        <ArrowLeftIcon data-icon="inline-start" />
        返回 DSH 界面
      </Button>
      <Button size="sm" variant="ghost" @click="emit('open-settings')">
        <SettingsIcon data-icon="inline-start" />
        设置
      </Button>
      <Button v-if="inElectron" size="sm" variant="ghost" @click="toggleDevtools">
        <SquareTerminalIcon data-icon="inline-start" />
        打开控制台
      </Button>
      <span class="text-xs text-muted-foreground">
        可通过系统托盘切换 Profile、查看日志或退出
      </span>
    </CardFooter>
  </Card>
</template>
