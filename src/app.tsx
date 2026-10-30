import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Cover, coverFor, useServerStanding, type CoverState } from 'kehikot-module-protocol/client/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NameForm } from '@/components/menu'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Hint } from '@/controls'
import { DeckEditor, type Editor } from '@/editor/deck-editor'
import { headerOf, type Work } from '@/header'
import { HeaderMenu } from '@/header-menu'
import { HistoryDialog } from '@/history'
import { OpenAddressContext, openerOf } from '@/lib/links'
import { PictureProject } from '@/slides/markdown'
import { decks as realDecks, type Decks } from '@/wire/decks'
import { useKehikot, type Host, type Press } from '@/wire/use-kehikot'
import { Workspace } from '@/workspace'

import type { DeckSummary, WatchEvent } from '../deck/api.ts'
import type { SaveState } from './use-deck.ts'

export function App() {
  return <Screen host={useKehikot()} />
}

/**
 * The slides screen: the open deck's workspace, and nothing over it.
 *
 * It used to have a strip of its own — the deck switcher, the save word, following, Present,
 * Presenter view, Export PDF, History — and, when narrow, a second row of tabs. All of that is
 * declared to the host (`header.ts`) and drawn in the container's own header as View, Go and Run;
 * a page no host draws that for has the same items behind one small control in its corner
 * (`header-menu.tsx`). What a menu cannot hold is asked in a dialog: a new deck's name, a new name
 * for this one. Whether the deck is saved is a dot in the corner, and a word where there is room.
 *
 * Rendered from a plain `Host` and a `Decks` client, so a test draws it with fakes.
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
  const hostOpens = host.openAddress
  const hostAnswers = host.answers
  const openAddress = useMemo(() => openerOf({ answers: hostAnswers, openAddress: hostOpens }), [hostAnswers, hostOpens])
  const [list, setList] = useState<DeckSummary[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [state, setState] = useState<SaveState | null>(null)
  const [watched, setWatched] = useState<WatchEvent | null>(null)
  /* Bumped to remount the workspace with what is on disk (after an undo). */
  const [generation, setGeneration] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  /* The one name being asked for, if any: a new deck's, or a new one for the open deck. */
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null)
  /* What the open deck's own header items are made of (see Workspace), and what takes a press on one. */
  const [work, setWork] = useState<Work | null>(null)
  const act = useRef<Press | null>(null)

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

  const here = ordered.find((one) => one.slug === open) ?? null
  const retitle = async (title: string) => {
    if (!project || !here) return false
    try {
      await decks.retitle(project, here.slug, title)
      await refresh()
      return true
    } catch (caught) {
      setFailed(said(caught))
      return false
    }
  }

  /*
   * The header: declared whole, and again only when it is a different list. While there is no
   * project or no list there is nothing to offer, and the page says so by declaring none.
   */
  const items = useMemo(
    () => (project && list && !cover ? headerOf({ decks: ordered.map((one) => ({ slug: one.slug, title: one.title })), open, work: open ? work : null, surface: host.drawsHeader === true }) : []),
    [project, list, cover, ordered, open, work, host.drawsHeader],
  )
  const itemsKey = JSON.stringify(items)
  const { header } = host
  useEffect(() => {
    header(items)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header, itemsKey])
  const press: Press = (pressing) => {
    const { item, value } = pressing
    if (item === 'deck') {
      const to = typeof value === 'string' && value.startsWith('d') ? ordered[Number(value.slice(1))] : undefined
      if (!to) return 'That deck is no longer one of this project’s.'
      setOpen(to.slug)
    } else if (item === 'history') setHistoryOpen(true)
    else if (item === 'deck-new') setNaming('new')
    else if (item === 'deck-rename') setNaming('rename')
    else if (item === 'deck-remove') {
      if (!project || !here) return 'No deck is open.'
      void decks
        .remove(project, here.slug)
        .then(refresh)
        .catch((caught: unknown) => setFailed(said(caught)))
    } else return act.current?.(pressing) ?? 'That is not something these slides have.'
    return true
  }
  host.presses.current = press
  const { presses } = host
  useEffect(
    () => () => {
      presses.current = null
    },
    [presses],
  )

  /* F2 renames the open deck, as it did on its row in the deck menu — from anywhere in the page now. */
  const canName = !!project && !!here && !work?.presenting
  useEffect(() => {
    if (!canName) return
    const down = (event: KeyboardEvent) => {
      if (event.key !== 'F2' || event.metaKey || event.ctrlKey || event.altKey) return
      event.preventDefault()
      setNaming('rename')
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [canName])

  return (
    <div className="relative flex h-screen flex-col text-sm">
      {/* No strip. The page's own way to the items, only where no host draws them: nobody frames this page, or
          the host says it draws none, or says nothing and has not pressed one yet. */}
      {host.where !== 'hosted' || !(host.drawsHeader ?? host.pressed) ? <HeaderMenu items={items} onPress={press} /> : null}
      {open && state && !cover ? <SaveWord state={state} /> : null}
      <Dialog open={naming !== null} onOpenChange={(now) => !now && setNaming(null)}>
        <DialogContent className="max-w-xs gap-2 p-3">
          <DialogHeader>
            <DialogTitle className="text-sm">{naming === 'rename' ? 'Rename this deck' : 'New deck'}</DialogTitle>
            <DialogDescription className="text-xs">
              {naming === 'rename' ? 'Its file keeps its name; only the title changes.' : 'A deck is one Markdown file in this project.'}
            </DialogDescription>
          </DialogHeader>
          {naming ? (
            <NameForm
              heading=""
              initial={naming === 'rename' ? (here?.title ?? '') : ''}
              label="deck name"
              maxLength={80}
              onSave={(name) => (naming === 'rename' ? retitle(name) : create(name))}
              onDone={() => setNaming(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
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
          <PictureProject.Provider value={project}>
            <OpenAddressContext.Provider value={openAddress}>
            <Workspace
              key={open}
              reread={generation}
              decks={decks}
              host={host}
              project={project}
              slug={open}
              watched={watched}
              editor={editor}
              theme={host.theme}
              saveDelay={saveDelay}
              publishDelay={publishDelay}
              onWork={setWork}
              act={act}
              onState={setState}
            />
            </OpenAddressContext.Provider>
          </PictureProject.Provider>
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

/**
 * Whether the deck is saved, laid over the bottom right corner where it takes no row: a dot, with the
 * word as its tooltip, and the word itself where the page is wide enough to have room beside the
 * slide's number.
 */
function SaveWord({ state }: { state: SaveState }) {
  const bad = state === 'conflict' || state === 'failed'
  return (
    <span className="@container pointer-events-none absolute right-1.5 bottom-1.5 z-20 flex w-full items-center justify-end">
      <Hint text={WORDS[state]}>
        <span
          role="img"
          aria-label={WORDS[state]}
          className={`pointer-events-auto size-2 shrink-0 rounded-full @min-[520px]:hidden ${bad ? 'bg-destructive' : state === 'saved' ? 'bg-muted-foreground/50' : 'bg-foreground/70'}`}
        />
      </Hint>
      <span
        data-testid="save-state"
        className={`bg-background/80 hidden rounded px-1 text-[11px] @min-[520px]:inline ${bad ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {WORDS[state]}
      </span>
    </span>
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
