import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switcher, type Item } from '@/switcher'
import { api as realApi, type Api } from '@/wire/api'
import { useRoadmap, type Host } from '@/wire/use-roadmap'

export function App() {
  return <Screen host={useRoadmap()} />
}

/**
 * The placeholder screen: a header strip, and a body saying what the host told
 * this module and keeping one value in the project. Rendered from a plain
 * `Host`, so a test can draw it with a fake context (see test/render.test.tsx).
 */
export function Screen({ host, api = realApi }: { host: Host; api?: Api }) {
  return (
    <div className="flex h-screen flex-col text-sm">
      <Header host={host} />
      <main className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
        <Context host={host} />
        <Stored projectPath={host.projectPath} api={api} />
      </main>
    </div>
  )
}

/** The strip: the module's own controls, small, in one row that wraps rather than scrolls. */
function Header({ host }: { host: Host }) {
  const [items, setItems] = useState<Item[]>([
    { id: 'first', name: 'First' },
    { id: 'second', name: 'Second' },
  ])
  const [current, setCurrent] = useState<string | null>('first')

  return (
    <header className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-2 py-1">
      <span className="text-xs font-medium">Slides</span>
      <Switcher
        noun="item"
        items={items}
        current={current}
        onPick={setCurrent}
        onRename={(id, name) => {
          setItems((was) => was.map((one) => (one.id === id ? { ...one, name } : one)))
          return true
        }}
        onRemove={(id) => {
          setItems((was) => was.filter((one) => one.id !== id))
          if (current === id) setCurrent(null)
        }}
        onCreate={(name) => {
          const id = `${Date.now()}`
          setItems((was) => [...was, { id, name }])
          setCurrent(id)
          return true
        }}
      />
      <Badge variant="outline" className="ml-auto" data-testid="where">
        {host.where}
      </Badge>
    </header>
  )
}

function Context({ host }: { host: Host }) {
  const rows: [string, string | null][] = [
    ['project', host.project],
    ['epic', host.epic],
    ['theme', host.theme],
  ]
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd data-testid={label}>{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

/** One JSON value, kept at <project>/.kehikot/slides/value.json through /api. */
function Stored({ projectPath, api }: { projectPath: string | null; api: Api }) {
  const [draft, setDraft] = useState('')
  const [said, setSaid] = useState<string | null>(null)

  useEffect(() => {
    if (!projectPath) return
    let live = true
    api
      .read(projectPath)
      .then((value) => {
        if (live) setDraft(typeof value === 'string' ? value : value === null ? '' : JSON.stringify(value))
      })
      .catch((error: unknown) => live && setSaid(error instanceof Error ? error.message : String(error)))
    return () => {
      live = false
    }
  }, [projectPath, api])

  if (!projectPath) {
    return <p className="text-muted-foreground">Open a project in the host to keep anything here.</p>
  }

  return (
    <form
      className="flex max-w-md flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        api
          .write(projectPath, draft)
          .then(() => setSaid('saved'))
          .catch((error: unknown) => setSaid(error instanceof Error ? error.message : String(error)))
      }}
    >
      <label className="text-muted-foreground text-xs" htmlFor="value">
        a value kept in this project
      </label>
      <div className="flex gap-2">
        <Input id="value" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <Button type="submit" size="sm">
          Save
        </Button>
      </div>
      {said ? <p className="text-muted-foreground text-xs" data-testid="said">{said}</p> : null}
    </form>
  )
}
