import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import {
  ArrowLeft,
  CircleCheck,
  CircleX,
  FolderPlus,
  Layers,
  LoaderCircle,
  Play,
} from "lucide-react"

import appIcon from "@/assets/app-icon.png"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { errMessage } from "@/lib/splash"

export default function SettingsPage() {
  const [profiles, setProfiles] = useState<string[]>([])
  const [current, setCurrent] = useState<string>("")
  const [newName, setNewName] = useState("")
  const [nameError, setNameError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [ps, cur] = await Promise.all([
          invoke<string[]>("list_profiles"),
          invoke<string>("current_profile"),
        ])
        if (!cancelled) {
          setProfiles(ps)
          setCurrent(cur)
        }
      } catch (e) {
        if (!cancelled) setError(`无法加载 Profile 列表：${errMessage(e)}`)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleCreate() {
    const name = newName.trim()
    if (!name) {
      setNameError("请输入 Profile 名称")
      return
    }
    setNameError(null)
    setCreating(true)
    setError(null)
    setInfo(null)
    try {
      await invoke("create_profile", { name })
      setNewName("")
      setInfo(`Profile “${name}” 已创建，可从下方列表或托盘“切换 Profile”启动它`)
      setProfiles(await invoke<string[]>("list_profiles"))
    } catch (e) {
      setError(errMessage(e))
    } finally {
      setCreating(false)
    }
  }

  async function handleSwitch(name: string) {
    setSwitching(name)
    setError(null)
    setInfo(null)
    try {
      await invoke("switch_profile", { name })
      setCurrent(name)
      setInfo(`正在切换到 “${name}”，就绪后窗口会自动打开主界面`)
    } catch (e) {
      setError(errMessage(e))
    } finally {
      setSwitching(null)
    }
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <div className="flex items-center gap-3">
          <img
            src={appIcon}
            alt="DSH Desktop"
            className="size-11 shrink-0 rounded-lg ring-1 ring-border"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <CardTitle>设置</CardTitle>
            <CardDescription>
              管理 Profile：新增后即可通过托盘“切换 Profile”或下方列表启动
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              window.location.hash = ""
            }}
          >
            <ArrowLeft data-icon="inline-start" />
            返回日志页
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {(error || info) && (
          <Alert variant={error ? "destructive" : "default"}>
            {error ? <CircleX /> : <CircleCheck />}
            <AlertTitle>{error ? "操作失败" : "成功"}</AlertTitle>
            <AlertDescription>{error ?? info}</AlertDescription>
          </Alert>
        )}

        <FieldGroup>
          <Field data-invalid={nameError ? true : undefined}>
            <FieldLabel htmlFor="profile-name">新增 Profile</FieldLabel>
            <FieldDescription>
              名称只能包含字母、数字、- 和 _；创建后即出现在托盘“切换 Profile”菜单中
            </FieldDescription>
            <div className="flex w-full gap-2">
              <Input
                id="profile-name"
                placeholder="例如 my-profile"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate()
                }}
                aria-invalid={nameError ? true : undefined}
                disabled={creating}
              />
              <Button onClick={() => void handleCreate()} disabled={creating}>
                {creating ? (
                  <LoaderCircle data-icon="inline-start" className="animate-spin" />
                ) : (
                  <FolderPlus data-icon="inline-start" />
                )}
                创建
              </Button>
            </div>
            <FieldError>{nameError}</FieldError>
          </Field>
        </FieldGroup>

        <Separator />

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <Layers className="size-4 text-muted-foreground" />
            已有 Profiles
            <Badge variant="secondary">{profiles.length}</Badge>
          </div>

          {profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              暂无 Profile，先在上面创建一个吧。
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {profiles.map((p) => (
                <div
                  key={p}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-sm">{p}</span>
                    {p === current && <Badge variant="success">当前</Badge>}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={p === current || switching !== null}
                    onClick={() => void handleSwitch(p)}
                  >
                    {switching === p ? (
                      <LoaderCircle
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                    ) : (
                      <Play data-icon="inline-start" />
                    )}
                    启动
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
