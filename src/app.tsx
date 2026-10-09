import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Cover, coverFor, useServerStanding, type CoverState } from 'kehikot-module-protocol/client/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Hint } from '@/controls'
import { DeckEditor, type Editor } from '@/editor/deck-editor'
import { HistoryDialog } from '@/history'
import { Switcher, type Item } from '@/switcher'
import { decks as realDecks, type Decks } from '@/wire/decks'
import { useKehikot, type Host } from '@/wire/use-kehikot'
import { Workspace } from '@/workspace'

import type { DeckSummary, WatchEvent } from '../deck/api.ts'
import type { SaveState } from './use-deck.ts'

export function App() {
  return <Screen host={useKehikot()} />
}

/**
 * The slides screen: a header strip (deck switcher, save state, the open
 * deck's controls — following the paper, Present, PDF — and History) over the open deck's workspace. Rendered from a plain `Host` and a
 * `Decks` client, so a test draws it with fakes (see test/screen.test.tsx).
 */
export function Screen({
  host,
  decks = realDecks,
  editor = DeckEditor,
  saveDelay = 600,
  publishDelay,
}: {
  host: Host
  decks?: Decks
  /** The Markdown editor; CodeMirror unless a test swaps it. */
  editor?: Editor
  saveDelay?: number
  publishDelay?: number
}) {
  const project = host.projectPath
  const [list, setList] = useState<DeckSummary[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [state, setState] = useState<SaveState | null>(null)
  const [watched, setWatched] = useState<WatchEvent | null>(null)
  /* Bumped to remount the workspace with what is on disk (after an undo). */
  const [generation, setGeneration] = useState(0)
  /* Where the workspace draws the open deck's controls (see Workspace). */
  const [historyOpen, setHistoryOpen] = useState(false)
  const [controls, setControls] = useState<HTMLSpanElement | null>(null)

  const refresh = useCallback(async () => {
    if (!project) return
    try {
      setList(await decks.list(project))
      setFailed(null)
    } catch (caught) {
      setFailed(said(caught))
      setList((was) => was ?? [])
    }
  }, [decks, project])

  useEffect(() => {
    setList(null)
    setOpen(null)
    if (!project) return
    void refresh()
    return decks.watch(project, (event) => {
      /* A fresh object each time, so the same version announced twice still arrives. */
      setWatched({ ...event })
      void refresh()
    })
  }, [project, decks, refresh])

  const ordered = useMemo(() => byEpic(list ?? [], host.epic), [list, host.epic])

  /* Keep something open: the open deck while it exists, else the first in order. */
  useEffect(() => {
    if (!list) return
    if (open && list.some((one) => one.slug === open)) return
    setOpen(ordered[0]?.slug ?? null)
  }, [list, ordered, open])

  /* Follow the epic: when the host turns to another, open that epic's first
     deck. One with no deck leaves the open deck in place, and a deck picked by
     hand stays until the epic changes again. */
  const followed = useRef(host.epic)
  useEffect(() => {
    if (!list || followed.current === host.epic) return
    followed.current = host.epic
    const first = ordered[0]
    if (first && host.epic !== null && first.epic === host.epic) setOpen(first.slug)
  }, [list, ordered, host.epic])

  const create = async (title: string) => {
    if (!project) return false
    try {
      const slug = await decks.create(project, title, host.epic)
      await refresh()
      setOpen(slug)
      return true
    } catch (caught) {
      setFailed(said(caught))
      return false
    }
  }

  /*
   * Every not-ready moment is the protocol's one cover, in the order that is true: waiting before
   * anything has greeted the page, then unhosted, then no project. The server not answering takes
   * the screen only while there is no list to show — over an open deck it is the alert line above,
   * so nothing being edited is taken away.
   */
  const server = useServerStanding()
  const ready: CoverState | null = coverFor({ where: host.where, projectPath: host.projectPath, server })
  const cover = ready === 'down' && list?.length ? null : (ready ?? (!list ? 'loading' : null))

  const items: Item[] = ordered.map((one) => ({ id: one.slug, name: one.title }))

  return (
    <div className="flex h-screen flex-col text-sm">
      <header className="@container flex min-h-9 shrink-0 flex-nowrap items-center gap-x-2 border-b px-2 py-1">
        <span className="shrink-0 text-xs font-medium">Slides</span>
        {project && list ? (
          <Switcher
            noun="deck"
            items={items}
            current={open}
            onPick={setOpen}
            onRename={async (slug, title) => {
              try {
                await decks.retitle(project, slug, title)
                await refresh()
                return true
              } catch (caught) {
                setFailed(said(caught))
                return false
              }
            }}
            onRemove={(slug) => {
              void decks
                .remove(project, slug)
                .then(refresh)
                .catch((caught: unknown) => setFailed(said(caught)))
            }}
            onCreate={create}
          />
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {open && state ? <SaveWord state={state} /> : null}
          <span ref={setControls} className="contents" />
        </div>
      </header>
      {project && open ? (
        <HistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          decks={decks}
          project={project}
          slug={open}
          onUndone={() => setGeneration((n) => n + 1)}
        />
      ) : null}
      {failed && cover !== 'down' ? (
        <p role="alert" className="text-destructive border-b px-3 py-1 text-xs">
          {failed}
        </p>
      ) : null}
      <main className="@container flex min-h-0 flex-1 flex-col">
        {cover ? (
          <Cover state={cover} name="Slides" onRetry={() => void refresh()} />
        ) : !project || !list ? null : !open ? (
          <FirstDeck onCreate={create} />
        ) : (
          <Workspace
            key={`${open}:${generation}`}
            decks={decks}
            host={host}
            project={project}
            slug={open}
            watched={watched}
            editor={editor}
            theme={host.theme}
            saveDelay={saveDelay}
            publishDelay={publishDelay}
            header={controls}
            onHistory={() => setHistoryOpen(true)}
            onState={setState}
          />
        )}
      </main>
    </div>
  )
}

/** The open epic's decks first, then the rest, each group by title. */
export function byEpic(list: DeckSummary[], epic: string | null): DeckSummary[] {
  const byTitle = (a: DeckSummary, b: DeckSummary) => a.title.localeCompare(b.title)
  const ours = (one: DeckSummary) => epic !== null && one.epic === epic
  return [...list.filter(ours).sort(byTitle), ...list.filter((one) => !ours(one)).sort(byTitle)]
}

function said(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

const WORDS: Record<SaveState, string> = {
  loading: 'opening…',
  saved: 'saved',
  unsaved: 'editing',
  saving: 'saving…',
  conflict: 'not saved',
  failed: 'not saved',
}

function SaveWord({ state }: { state: SaveState }) {
  const bad = state === 'conflict' || state === 'failed'
  return (
    <>
      {/* Narrow: a dot with the word as its tooltip; wide: the word itself. */}
      <Hint text={WORDS[state]}>
        <span
          role="img"
          aria-label={WORDS[state]}
          className={`mx-1 size-2 shrink-0 rounded-full @min-[520px]:hidden ${bad ? 'bg-destructive' : state === 'saved' ? 'bg-muted-foreground/50' : 'bg-foreground/70'}`}
        />
      </Hint>
      <span
        data-testid="save-state"
        className={`hidden px-1 text-[11px] @min-[520px]:inline ${bad ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {WORDS[state]}
      </span>
    </>
  )
}

function FirstDeck({ onCreate }: { onCreate(title: string): Promise<boolean> }) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="m-auto flex w-full max-w-xs flex-col gap-2 p-6"
      onSubmit={(event) => {
        event.preventDefault()
        setBusy(true)
        void onCreate(title.trim() || 'Untitled deck').finally(() => setBusy(false))
      }}
    >
      <p className="text-xs font-medium">No decks yet</p>
      <p className="text-muted-foreground text-xs">
        A deck is one Markdown file in this project. Name the first one; you can rename it later.
      </p>
      <div className="flex gap-2">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Untitled deck"
          aria-label="deck title"
          maxLength={80}
          className="h-8 text-xs"
        />
        <Button type="submit" size="sm" className="h-8 text-xs" disabled={busy}>
          Create deck
        </Button>
      </div>
    </form>
  )
}
