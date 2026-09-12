<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  CircleCheckIcon,
  CircleXIcon,
  LoaderCircleIcon,
  PackageMinusIcon,
  PackagePlusIcon,
  PlugZapIcon,
  RefreshCwIcon
} from '@lucide/vue'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { errMessage } from '@/lib/splash'

const props = defineProps<{
  profile: string
}>()

interface PluginInfo {
  name: string
  version: string
}

const plugins = ref<PluginInfo[]>([])
const loaded = ref(false)
const spec = ref('')
const inputError = ref<string | null>(null)
const adding = ref(false)
const removing = ref<string | null>(null)
const reloading = ref(false)
const error = ref<string | null>(null)
const info = ref<string | null>(null)

const pluginCount = computed(() => plugins.value.length)

onMounted(async () => {
  try {
    plugins.value = await window.api.listPlugins(props.profile)
  } catch (e) {
    error.value = `无法加载插件列表：${errMessage(e)}`
  } finally {
    loaded.value = true
  }
})

async function refresh(): Promise<void> {
  try {
    plugins.value = await window.api.listPlugins(props.profile)
  } catch (e) {
    error.value = errMessage(e)
  }
}

async function handleAdd(): Promise<void> {
  const specs = spec.value
    .trim()
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (specs.length === 0) {
    inputError.value = '请输入要安装的插件包名，多个包用空格分隔'
    return
  }
  inputError.value = null
  error.value = null
  info.value = null
  adding.value = true
  try {
    plugins.value = await window.api.addPlugins(props.profile, specs)
    spec.value = ''
    info.value = `已安装：${specs.join('、')}`
  } catch (e) {
    error.value = errMessage(e)
  } finally {
    adding.value = false
  }
}

async function handleRemove(name: string): Promise<void> {
  if (!window.confirm(`确定要从 Profile “${props.profile}” 中移除插件 ${name} 吗？`)) return
  error.value = null
  info.value = null
  removing.value = name
  try {
    plugins.value = await window.api.removePlugin(props.profile, name)
    info.value = `已移除：${name}`
  } catch (e) {
    error.value = errMessage(e)
  } finally {
    removing.value = null
  }
}

async function handleReload(): Promise<void> {
  error.value = null
  info.value = null
  reloading.value = true
  try {
    await window.api.reloadProfile()
    info.value = '正在重新加载当前 Profile，稍后主界面会自动刷新'
  } catch (e) {
    error.value = `重新加载失败：${errMessage(e)}`
  } finally {
    reloading.value = false
  }
}

function handleSpecInput(): void {
  if (inputError.value) inputError.value = null
}
</script>

<template>
  <section class="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4">
    <div class="flex flex-wrap items-center gap-2 text-sm font-medium">
      <PlugZapIcon class="size-4 text-muted-foreground" />
      <span>插件管理</span>
      <Badge variant="secondary">Profile: {{ profile }}</Badge>
      <Badge variant="outline">{{ pluginCount }} 个已安装</Badge>
    </div>

    <p class="text-sm text-muted-foreground">
      通过 dsh 的 pnpm 转发在当前 Profile 安装 / 移除插件。安装后点击“重新加载 Profile”生效。
    </p>

    <div class="flex flex-col gap-2">
      <label class="text-xs font-medium text-muted-foreground" for="plugin-spec"> 安装插件 </label>
      <div class="flex w-full gap-2">
        <Input
          id="plugin-spec"
          v-model="spec"
          placeholder="例如 @deepseek-ai/dsh-xxx，多个包用空格分隔"
          :aria-invalid="inputError ? true : undefined"
          :disabled="adding"
          @input="handleSpecInput"
          @keydown.enter="handleAdd"
        />
        <Button :disabled="adding" @click="handleAdd">
          <LoaderCircleIcon v-if="adding" data-icon="inline-start" class="animate-spin" />
          <PackagePlusIcon v-else data-icon="inline-start" />
          {{ adding ? '安装中…' : '安装' }}
        </Button>
      </div>
      <p v-if="inputError" class="text-sm text-destructive">{{ inputError }}</p>
    </div>

    <div v-if="error || info" class="flex flex-col gap-2">
      <div
        v-if="error"
        class="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        <CircleXIcon class="mt-0.5 size-4 shrink-0" />
        <span class="min-w-0 break-all">{{ error }}</span>
      </div>
      <div
        v-else-if="info"
        class="flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm"
      >
        <CircleCheckIcon class="mt-0.5 size-4 shrink-0 text-success" />
        <span class="min-w-0 break-all">{{ info }}</span>
      </div>
    </div>

    <div v-if="plugins.length === 0 && loaded" class="text-sm text-muted-foreground">
      当前 Profile 暂无插件，可在上方输入包名安装。
    </div>

    <div v-else class="flex flex-col gap-2">
      <div
        v-for="p in plugins"
        :key="p.name"
        class="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
      >
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="truncate font-mono text-sm">{{ p.name }}</span>
          <span class="truncate text-xs text-muted-foreground">v{{ p.version }}</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          class="shrink-0"
          :disabled="removing !== null"
          @click="handleRemove(p.name)"
        >
          <LoaderCircleIcon
            v-if="removing === p.name"
            data-icon="inline-start"
            class="animate-spin"
          />
          <PackageMinusIcon v-else data-icon="inline-start" />
          移除
        </Button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" :disabled="reloading" @click="handleReload">
        <LoaderCircleIcon v-if="reloading" data-icon="inline-start" class="animate-spin" />
        <RefreshCwIcon v-else data-icon="inline-start" />
        重新加载 Profile
      </Button>
      <Button size="sm" variant="ghost" @click="refresh">
        <RefreshCwIcon data-icon="inline-start" />
        刷新列表
      </Button>
    </div>
  </section>
</template>
