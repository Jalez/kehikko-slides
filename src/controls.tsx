import { Copy, ExternalLink, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** A tooltip on a header control, which is all most of them say about themselves. */
export function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{text}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The words on the following toggle: what it is doing, or why it is not moving the slides. The
 * toggle itself is the host's to draw (`header.ts`); these are the words it is declared with.
 */
export function followingLabel(
  on: boolean,
  presenting: boolean,
  missing: string | null,
  aside: { title: string; slide: number } | null = null,
): string {
  if (!on) return 'Not following'
  if (presenting) return 'Paused while presenting'
  if (missing) return `No slides for ${missing}`
  /* The paper is on a section whose slide is not among the slides drawn: said here, not jumped to. What is picked is
     the host's to say, and is not named. */
  /* The number first: the host draws these words in a menu row, and what is cut off the end of one is the title. */
  if (aside) return `Slide ${aside.slide + 1} is not among those shown: ${aside.title}`
  return 'Following the paper'
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
      {/* A press here is a press IN this page, which is what a browser wants before it opens a window:
          the Run menu's press came from the host's page, and a window asked for on its behalf is a pop-up. */}
      <Button asChild variant="outline" size="sm" className="h-6 gap-1 px-2 text-xs">
        <a href={url} target="_blank" rel="noreferrer" onClick={onDismiss}>
          <ExternalLink className="size-3" />
          Open
        </a>
      </Button>
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
