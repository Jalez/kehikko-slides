import { Copy, FileDown, Link2, Link2Off, Play, Presentation, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import type { Reading } from './follow.ts'

/** A tooltip on a header control, which is all most of them say about themselves. */
export function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{text}</TooltipContent>
    </Tooltip>
  )
}

/** The words on the following toggle: what it is doing, or why it is not moving the slides. */
export function followingLabel(on: boolean, presenting: boolean, missing: string | null): string {
  if (!on) return 'Not following'
  if (presenting) return 'Paused while presenting'
  if (missing) return `No slides for ${missing}`
  return 'Following the paper'
}

export function FollowingToggle({
  on,
  presenting,
  reading,
  missing,
  onToggle,
}: {
  on: boolean
  presenting: boolean
  reading: Reading | null
  missing: string | null
  onToggle(): void
}) {
  const where = reading ? `The paper is on “${reading.title}”.` : 'The paper is not on a section.'
  const what = on ? 'Press to stop following it.' : 'Press to follow it again.'
  return (
    <Hint text={`${where} ${what}`}>
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={on}
        data-testid="following"
        className={`h-7 gap-1 px-2 text-xs ${on ? '' : 'text-muted-foreground'}`}
        onClick={onToggle}
      >
        {on ? <Link2 className="size-3.5" /> : <Link2Off className="size-3.5" />}
        <span className="max-w-44 truncate">{followingLabel(on, presenting, missing)}</span>
      </Button>
    </Hint>
  )
}

export function PresentButtons({ onPresent, onPresenterView }: { onPresent(): void; onPresenterView(): void }) {
  return (
    <>
      <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onPresent}>
        <Play className="size-3.5" />
        Present
      </Button>
      <Hint text="Presenter view: notes, the next slide and a timer, in a window of its own.">
        <Button variant="ghost" size="icon" aria-label="Presenter view" className="size-7" onClick={onPresenterView}>
          <Presentation className="size-3.5" />
        </Button>
      </Hint>
    </>
  )
}

export function ExportPdfButton({ onExport }: { onExport(): void }) {
  return (
    <Hint text="Export PDF: opens the print view, one slide per page.">
      <Button variant="ghost" size="sm" aria-label="Export PDF" className="h-7 gap-1 px-2 text-xs" onClick={onExport}>
        <FileDown className="size-3.5" />
        PDF
      </Button>
    </Hint>
  )
}

/** A window could not be opened from here: the address to open by hand. */
export function OpenItYourself({ what, url, onDismiss }: { what: string; url: string; onDismiss(): void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div role="status" className="bg-muted/60 flex flex-wrap items-center gap-2 border-b px-3 py-1 text-xs">
      <span>{what} could not open a window here. Open it in your browser:</span>
      <Input
        readOnly
        value={url}
        aria-label={`${what} address`}
        className="h-6 min-w-40 flex-1 text-xs"
        onFocus={(event) => event.currentTarget.select()}
      />
      <Button
        variant="outline"
        size="sm"
        className="h-6 gap-1 px-2 text-xs"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(url)
            .then(() => setCopied(true))
            .catch(() => setCopied(false))
        }}
      >
        <Copy className="size-3" />
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <Button variant="ghost" size="icon" aria-label="dismiss" className="size-6" onClick={onDismiss}>
        <X className="size-3.5" />
      </Button>
    </div>
  )
}
