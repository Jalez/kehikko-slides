import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Decks } from '@/wire/decks'

import type { HistoryEntry } from '../deck/api.ts'

/**
 * History: the writes agents made to the open deck through the MCP door,
 * newest first, each with Undo — which puts back the text from before that
 * write. A person's own edits are not here; the editor's undo is for those.
 */
export function HistoryDialog({
  open,
  onOpenChange,
  decks,
  project,
  slug,
  onUndone,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  decks: Decks
  project: string
  slug: string
  /** An undo was written: the open deck should be read again. */
  onUndone(): void
}) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = () =>
    decks
      .history(project, slug)
      .then((list) => {
        setEntries([...list].sort((a, b) => b.at.localeCompare(a.at)))
        setFailed(null)
      })
      .catch((caught: unknown) => setFailed(caught instanceof Error ? caught.message : String(caught)))

  useEffect(() => {
    if (!open) return
    setEntries(null)
    void load()
  }, [open, project, slug])

  const undo = async (id: string) => {
    setBusy(id)
    try {
      await decks.undo(project, slug, id)
      onUndone()
      await load()
    } catch (caught) {
      setFailed(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80cqh] max-w-md grid-rows-[auto_1fr] gap-3 p-4">
        <DialogHeader>
          <DialogTitle className="text-sm">Agent edits</DialogTitle>
          <DialogDescription className="text-xs">
            Writes agents made to this deck. Undo puts back what was there before one.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          {failed ? <p className="text-destructive text-xs">{failed}</p> : null}
          {entries === null && !failed ? <p className="text-muted-foreground text-xs">Loading…</p> : null}
          {entries?.length === 0 ? (
            <p className="text-muted-foreground text-xs">No agent has edited this deck.</p>
          ) : null}
          <ul className="divide-y">
            {entries?.map((entry) => (
              <li key={entry.id} className="flex items-start gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs">{entry.summary || 'an edit'}</p>
                  <p className="text-muted-foreground text-[11px]">
                    {entry.agent} · {when(entry.at)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 shrink-0 px-2 text-xs"
                  disabled={busy !== null}
                  aria-label={`undo ${entry.summary}`}
                  onClick={() => void undo(entry.id)}
                >
                  {busy === entry.id ? 'undoing…' : 'Undo'}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function when(at: string): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return at
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
