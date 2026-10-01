import { Copy, FileDown, History, Link2, Link2Off, MoreHorizontal, Play, Presentation, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheck,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

const PRESENTER_HINT = 'Presenter view: notes, the next slide and a timer, in a window of its own.'
const PDF_HINT = 'Export PDF: opens the print view, one slide per page.'

/**
 * The header's controls for the open deck. They respond to the header's own
 * width (it is an `@container`), never the window's:
 *
 *  - always: Present (its label from 440px up);
 *  - 400px and up: following, Presenter view, Export PDF and History as small
 *    icon buttons (the following toggle spells itself out from 720px);
 *  - below 400px: those four fold into one "More" menu.
 */
export function HeaderControls({
  following,
  presenting,
  reading,
  missing,
  onToggleFollowing,
  onPresent,
  onPresenterView,
  onExport,
  onHistory,
}: {
  following: boolean
  presenting: boolean
  reading: Reading | null
  missing: string | null
  onToggleFollowing(): void
  onPresent(): void
  onPresenterView(): void
  onExport(): void
  onHistory(): void
}) {
  return (
    <>
      <Hint text="Present: full screen, from the slide on screen.">
        <Button variant="ghost" size="sm" aria-label="Present" className="h-7 shrink-0 gap-1 px-2 text-xs" onClick={onPresent}>
          <Play className="size-3.5" />
          <span className="hidden @min-[440px]:inline">Present</span>
        </Button>
      </Hint>
      <span data-testid="header-inline" className="hidden items-center gap-1 @min-[400px]:flex">
        <FollowingToggle
          on={following}
          presenting={presenting}
          reading={reading}
          missing={missing}
          onToggle={onToggleFollowing}
        />
        <Hint text={PRESENTER_HINT}>
          <Button variant="ghost" size="icon" aria-label="Presenter view" className="size-7" onClick={onPresenterView}>
            <Presentation className="size-3.5" />
          </Button>
        </Hint>
        <Hint text={PDF_HINT}>
          <Button variant="ghost" size="icon" aria-label="Export PDF" className="size-7" onClick={onExport}>
            <FileDown className="size-3.5" />
          </Button>
        </Hint>
        <Hint text="History: what agents changed in this deck, with Undo.">
          <Button variant="ghost" size="icon" aria-label="History" className="size-7" onClick={onHistory}>
            <History className="size-3.5" />
          </Button>
        </Hint>
      </span>
      <span data-testid="header-more" className="flex @min-[400px]:hidden">
        <DropdownMenu>
          <Hint text="More">
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions" className="size-7">
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem role="menuitemcheckbox" aria-checked={following} onSelect={onToggleFollowing}>
              <DropdownMenuCheck checked={following} />
              <span className="min-w-0 flex-1 truncate">Follow the paper</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onPresenterView}>
              <Presentation />
              Presenter view
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onExport}>
              <FileDown />
              Export PDF
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onHistory}>
              <History />
              History
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </>
  )
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
  const label = followingLabel(on, presenting, missing)
  return (
    <Hint text={`${label}. ${where} ${what}`}>
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={on}
        aria-label={label}
        data-testid="following"
        className={`h-7 min-w-0 gap-1 px-2 text-xs ${on ? '' : 'text-muted-foreground'}`}
        onClick={onToggle}
      >
        {on ? <Link2 className="size-3.5 shrink-0" /> : <Link2Off className="size-3.5 shrink-0" />}
        <span className="hidden max-w-44 truncate @min-[720px]:inline">{label}</span>
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
