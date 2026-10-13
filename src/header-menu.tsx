import { LoaderCircle, MoreHorizontal } from 'lucide-react'
import { useState } from 'react'

import { HEADER_MENUS, HEADER_MENU_NAMES, type HeaderItemInput, type HeaderMenu } from 'kehikot-module-protocol'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheck,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import type { Press } from './wire/use-kehikot.ts'

/**
 * The header's items, for a page whose host draws no header.
 *
 * Everything this page had in a strip of its own is declared to the host (`header.ts`) and drawn
 * in the container's row. Two pages have nobody to draw it: one opened by its address, and one
 * framed by a host from before the header. The first can be told (`where`). The second cannot: the
 * greeting carries the wire protocol's whole number and nothing about what a host draws, and a host
 * that does not know `kehikot.header` drops it in silence.
 *
 * So: ONE control, a "⋯" laid over the page's top right corner where it takes no row, with the same
 * items behind it — View, Go and Run as sections of one menu — and the same handler the host's
 * presses reach. It is there on a page nobody frames, and on a framed page until a press arrives
 * from a host, which only a host that draws the header sends; that is remembered
 * (`wire/use-kehikot.ts`), so on such a host it is gone from the first press on.
 */

const TITLES: Record<HeaderMenu, string> = { view: 'View', go: 'Go', run: 'Run' }

export function HeaderMenu({ items, onPress }: { items: HeaderItemInput[]; onPress: Press }) {
  /* A run that has to be confirmed is armed by the first press and done by the second. One at a time. */
  const [armed, setArmed] = useState<string | null>(null)
  if (!items.length) return null
  const busy = items.some((item) => item.kind === 'run' && item.state === 'busy')
  return (
    <DropdownMenu onOpenChange={(open) => !open && setArmed(null)}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label="Menu"
          title="View, go and run"
          data-testid="header-menu"
          className="bg-background/90 absolute top-1 right-1 z-30 h-5 w-6"
        >
          {busy ? <LoaderCircle className="size-3 animate-spin" /> : <MoreHorizontal className="size-3.5" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[80vh] w-60 max-w-[calc(100vw-0.5rem)] overflow-y-auto">
        {HEADER_MENU_NAMES.map((menu, at) => {
          const mine = items.filter((item) => HEADER_MENUS[item.kind] === menu)
          if (!mine.length) return null
          return (
            <div key={menu} role="group" aria-label={TITLES[menu]}>
              {at > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel className="text-foreground py-0.5 text-[11px] font-semibold">{TITLES[menu]}</DropdownMenuLabel>
              {mine.map((item) => (
                <Rows key={item.id} item={item} armed={armed === item.id} onArm={setArmed} onPress={onPress} />
              ))}
            </div>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const ROW = 'py-1 text-xs'

function Rows({ item, armed, onArm, onPress }: { item: HeaderItemInput; armed: boolean; onArm(id: string | null): void; onPress: Press }) {
  if (item.kind === 'toggle') {
    return (
      <DropdownMenuItem className={ROW} role="menuitemcheckbox" aria-checked={item.checked} data-item={item.id} onSelect={() => void onPress({ item: item.id, value: !item.checked })}>
        <DropdownMenuCheck checked={item.checked} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      </DropdownMenuItem>
    )
  }
  if (item.kind === 'run') {
    return (
      <DropdownMenuItem
        className={ROW}
        disabled={Boolean(item.disabled) || item.state === 'busy'}
        title={item.disabled ?? undefined}
        variant={armed ? 'destructive' : 'default'}
        data-item={item.id}
        onSelect={(event) => {
          if (item.confirm && !armed) {
            /* Kept open: the second press is the answer to the question the row just became. */
            event.preventDefault()
            onArm(item.id)
            return
          }
          onArm(null)
          void onPress({ item: item.id })
        }}
      >
        <span className="min-w-0 flex-1 truncate">{armed ? 'Press again to confirm' : item.label}</span>
        {item.shortcut && !armed ? <span className="text-muted-foreground pl-2 text-[10px]">{item.shortcut}</span> : null}
      </DropdownMenuItem>
    )
  }
  /* A switch and a go item are both a list of options under the item's own label; only a switch has one checked. */
  return (
    <>
      <DropdownMenuLabel className="truncate py-0.5 text-[11px] font-normal" title={item.label}>
        {item.label}
      </DropdownMenuLabel>
      {item.options.map((option) => (
        <DropdownMenuItem
          key={option.id}
          className={ROW}
          data-item={item.id}
          data-option={option.id}
          {...(item.kind === 'switch' ? { role: 'menuitemradio', 'aria-checked': option.id === item.value } : {})}
          onSelect={() => void onPress({ item: item.id, value: option.id })}
        >
          {item.kind === 'switch' ? <DropdownMenuCheck checked={option.id === item.value} /> : null}
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
        </DropdownMenuItem>
      ))}
    </>
  )
}
