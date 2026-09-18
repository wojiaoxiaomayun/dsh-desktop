<script setup lang="ts">
import {
  CopyIcon,
  MessageSquareIcon,
  MinusIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  SettingsIcon,
  SquareIcon,
  XIcon,
} from '@lucide/vue'

import appIcon from '@/assets/app-icon.png'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

defineProps<{
  route: 'app' | 'logs' | 'settings'
  maximized: boolean
}>()

const emit = defineEmits<{
  (e: 'open-app'): void
  (e: 'open-settings'): void
  (e: 'open-logs'): void
  (e: 'reload'): void
  (e: 'minimize'): void
  (e: 'maximize'): void
  (e: 'close'): void
}>()
</script>

<template>
  <header
    class="flex h-11 shrink-0 select-none items-center border-b border-border bg-background/80 backdrop-blur"
    style="-webkit-app-region: drag"
  >
    <!-- 左侧：logo + 应用名 -->
    <div class="flex min-w-0 flex-1 items-center gap-2 px-3">
      <img
        :src="appIcon"
        alt="DSH Desktop"
        class="size-5 shrink-0 rounded ring-1 ring-border"
      />
      <span class="truncate text-xs font-medium text-muted-foreground">DSH Desktop</span>
    </div>

    <!-- 右侧：刷新 / 导航 / 窗口控制（图标不带文字） -->
    <div
      class="flex items-center gap-0.5 pr-1"
      style="-webkit-app-region: no-drag"
    >
      <!-- 刷新分组：仅在聊天界面显示，连同分隔线一起隐藏 -->
      <template v-if="route === 'app'">
        <Button size="icon-sm" variant="ghost" title="刷新" @click="emit('reload')">
          <RefreshCwIcon />
        </Button>
        <Separator
          orientation="vertical"
          class="mx-1 h-5"
          style="align-self: center"
        />
      </template>

      <!-- 聊天按钮：非聊天页时显示，点击返回聊天界面 -->
      <Button
        v-if="route !== 'app'"
        size="icon-sm"
        variant="ghost"
        title="返回聊天"
        @click="emit('open-app')"
      >
        <MessageSquareIcon />
      </Button>
      <Button size="icon-sm" variant="ghost" title="日志" @click="emit('open-logs')">
        <ScrollTextIcon />
      </Button>
      <Button size="icon-sm" variant="ghost" title="设置" @click="emit('open-settings')">
        <SettingsIcon />
      </Button>

      <Separator
        orientation="vertical"
        class="mx-1 h-5"
        style="align-self: center"
      />

      <Button size="icon-sm" variant="ghost" title="最小化" @click="emit('minimize')">
        <MinusIcon />
      </Button>
      <Button size="icon-sm" variant="ghost" title="最大化/还原" @click="emit('maximize')">
        <component :is="maximized ? CopyIcon : SquareIcon" />
      </Button>
      <Button size="icon-sm" variant="ghost" title="关闭" @click="emit('close')">
        <XIcon />
      </Button>
    </div>
  </header>
</template>
