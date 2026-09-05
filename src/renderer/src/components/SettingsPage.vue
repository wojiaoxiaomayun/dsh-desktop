<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import {
  ArrowLeftIcon,
  CircleCheckIcon,
  CircleXIcon,
  FolderPlusIcon,
  LayersIcon,
  LoaderCircleIcon,
  PlayIcon,
} from '@lucide/vue'

import appIcon from '@/assets/app-icon.png'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { errMessage } from '@/lib/splash'

const profiles = ref<string[]>([])
const current = ref('')
const newName = ref('')
const nameError = ref<string | null>(null)
const creating = ref(false)
const switching = ref<string | null>(null)
const error = ref<string | null>(null)
const info = ref<string | null>(null)

let cancelled = false

onMounted(async () => {
  try {
    const [ps, cur] = await Promise.all([
      window.api.listProfiles(),
      window.api.currentProfile(),
    ])
    if (!cancelled) {
      profiles.value = ps
      current.value = cur
    }
  } catch (e) {
    if (!cancelled) error.value = `无法加载 Profile 列表：${errMessage(e)}`
  }
})

onUnmounted(() => {
  cancelled = true
})

async function handleCreate(): Promise<void> {
  const name = newName.value.trim()
  if (!name) {
    nameError.value = '请输入 Profile 名称'
    return
  }
  nameError.value = null
  creating.value = true
  error.value = null
  info.value = null
  try {
    await window.api.createProfile(name)
    newName.value = ''
    info.value = `Profile “${name}” 已创建，可从下方列表或托盘“切换 Profile”启动它`
    profiles.value = await window.api.listProfiles()
  } catch (e) {
    error.value = errMessage(e)
  } finally {
    creating.value = false
  }
}

async function handleSwitch(name: string): Promise<void> {
  switching.value = name
  error.value = null
  info.value = null
  try {
    await window.api.switchProfile(name)
    current.value = name
    info.value = `正在切换到 “${name}”，就绪后窗口会自动打开主界面`
  } catch (e) {
    error.value = errMessage(e)
  } finally {
    switching.value = null
  }
}

function goBack(): void {
  window.location.hash = ''
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
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <CardTitle>设置</CardTitle>
          <CardDescription>
            管理 Profile：新增后即可通过托盘“切换 Profile”或下方列表启动
          </CardDescription>
        </div>
        <Button size="sm" variant="ghost" @click="goBack">
          <ArrowLeftIcon data-icon="inline-start" />
          返回日志页
        </Button>
      </div>
    </CardHeader>

    <CardContent class="flex flex-col gap-5">
      <Alert v-if="error || info" :variant="error ? 'destructive' : 'default'">
        <CircleXIcon v-if="error" />
        <CircleCheckIcon v-else />
        <AlertTitle>{{ error ? '操作失败' : '成功' }}</AlertTitle>
        <AlertDescription>{{ error ?? info }}</AlertDescription>
      </Alert>

      <FieldGroup>
        <Field :data-invalid="nameError ? true : undefined">
          <FieldLabel for="profile-name">新增 Profile</FieldLabel>
          <FieldDescription>
            名称只能包含字母、数字、- 和 _；创建后即出现在托盘“切换 Profile”菜单中
          </FieldDescription>
          <div class="flex w-full gap-2">
            <Input
              id="profile-name"
              v-model="newName"
              placeholder="例如 my-profile"
              :aria-invalid="nameError ? true : undefined"
              :disabled="creating"
              @keydown.enter="handleCreate"
            />
            <Button :disabled="creating" @click="handleCreate">
              <LoaderCircleIcon v-if="creating" data-icon="inline-start" class="animate-spin" />
              <FolderPlusIcon v-else data-icon="inline-start" />
              创建
            </Button>
          </div>
          <FieldError v-if="nameError">{{ nameError }}</FieldError>
        </Field>
      </FieldGroup>

      <Separator />

      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-1.5 text-sm font-medium">
          <LayersIcon class="size-4 text-muted-foreground" />
          已有 Profiles
          <Badge variant="secondary">{{ profiles.length }}</Badge>
        </div>

        <p v-if="profiles.length === 0" class="text-sm text-muted-foreground">
          暂无 Profile，先在上面创建一个吧。
        </p>

        <div v-else class="flex flex-col gap-2">
          <div
            v-for="p in profiles"
            :key="p"
            class="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2"
          >
            <div class="flex min-w-0 items-center gap-2">
              <span class="truncate font-mono text-sm">{{ p }}</span>
              <Badge v-if="p === current" variant="success">当前</Badge>
            </div>
            <Button
              size="sm"
              variant="outline"
              :disabled="p === current || switching !== null"
              @click="handleSwitch(p)"
            >
              <LoaderCircleIcon
                v-if="switching === p"
                data-icon="inline-start"
                class="animate-spin"
              />
              <PlayIcon v-else data-icon="inline-start" />
              启动
            </Button>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
