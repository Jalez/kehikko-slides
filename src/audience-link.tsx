import { Check, Copy, ExternalLink, MonitorPlay, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Decks } from '@/wire/decks'

import type { AudienceLink } from '../deck/api.ts'

/**
 * "Audience view" in the presenter's window: the address of a page that shows only the slides and moves when
 * the presenter does, to copy or open in any browser on this machine.
 *
 * The address is this page's own origin plus the link's path, and this page is on the module's address as the
 * host gave it — the host's stable address for the module, not the port the module happened to bind, which
 * changes when it restarts. The key in the path is made and kept by the server (`audience.ts`); this only shows it.
 */

/** The address to hand out: the link's path on the origin this window was opened from. */
export function audienceUrl(path: string, origin: string = location.origin): string {
  return new URL(path, origin).href
}

export const WORDS = {
  open: 'Audience view',
  about: 'A page that shows only your slides, full window, and moves when you do. Open it in any browser on this computer.',
  copy: 'Copy',
  copied: 'Copied',
  browser: 'Open in browser',
  renew: 'New link',
  renewAbout: 'The link in use stops working.',
  none: 'No window is following yet.',
  one: '1 window is following.',
  many: (n: number) => `${n} windows are following.`,
  waiting: 'Making the link…',
} as const

export function AudienceControl({ decks, project, slug, origin }: { decks: Decks; project: string; slug: string; origin?: string }) {
  const [link, setLink] = useState<AudienceLink | null>(null)
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  /* The stream is the presenter being here: opened with the window, not with the panel, so the audience is not
     told "disconnected" because a panel was closed. */
  useEffect(() => decks.followAudience(project, slug, setLink), [decks, project, slug])

  useEffect(() => {
    if (!shown) return
    const key = (event: KeyboardEvent) => event.key === 'Escape' && setShown(false)
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [shown])

  const url = link ? audienceUrl(link.path, origin) : ''

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      /* No clipboard here (a plain http page in some browsers): select it, and the person copies. */
      field.current?.select()
      document.execCommand?.('copy')
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative">
      <Button variant="outline" size="sm" className="h-7 gap-1" aria-expanded={shown} onClick={() => setShown((was) => !was)}>
        <MonitorPlay className="size-3.5" />
        {WORDS.open}
        {link && link.viewers > 0 ? (
          <span data-testid="audience-count" className="text-muted-foreground tabular-nums">
            · {link.viewers}
          </span>
        ) : null}
      </Button>
      {shown ? (
        <section aria-label="audience view" className="bg-popover text-popover-foreground absolute top-full right-0 z-10 mt-1 flex w-96 max-w-[90vw] flex-col gap-2 rounded-md border p-3 shadow-md">
          <p className="text-muted-foreground text-xs">{WORDS.about}</p>
          <Input ref={field} readOnly aria-label="audience link" value={url || WORDS.waiting} onFocus={(event) => event.currentTarget.select()} className="h-8 font-mono text-xs" />
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-8 gap-1" disabled={!link} onClick={() => void copy()}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? WORDS.copied : WORDS.copy}
            </Button>
            <Button asChild size="sm" variant="outline" className="h-8 gap-1">
              <a href={url || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!link}>
                <ExternalLink className="size-3.5" />
                {WORDS.browser}
              </a>
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground ml-auto h-8 gap-1" title={WORDS.renewAbout} disabled={!link} onClick={() => void decks.renewAudience(project, slug)}>
              <RefreshCw className="size-3.5" />
              {WORDS.renew}
            </Button>
          </div>
          <p data-testid="audience-viewers" className="text-muted-foreground text-xs">
            {!link || link.viewers === 0 ? WORDS.none : link.viewers === 1 ? WORDS.one : WORDS.many(link.viewers)}
          </p>
        </section>
      ) : null}
    </div>
  )
}
