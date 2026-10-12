import { createContext, memo, useContext, useState, type ComponentProps } from 'react'
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { ask, ticket } from 'kehikot-module-protocol/client'
import type { PluggableList } from 'unified'

import { PATHS } from '../../deck/api.ts'
import { CITE_HREF, CiteMark } from './citations.tsx'

/**
 * The project the slides on screen belong to, for the pictures they name.
 * Null where nothing has said (a slide drawn on its own, a deck opened with
 * no project), and then a path is used as written.
 */
export const PictureProject = createContext<string | null>(null)

/**
 * Where a picture a slide names is fetched from. A URL (`https:`, `data:`, an
 * absolute `/…`) is used as written; anything else is a path relative to the
 * project, served by this app's own `/api/asset` door. That door is behind the
 * page's ticket, which an `<img>` can only carry in its address.
 */
export function assetUrl(path: string, project: string | null = null, carried: string = ticket()): string {
  if (!project) return path
  return `./api/asset?${new URLSearchParams(carried ? { project, path, ticket: carried } : { project, path })}`
}

/** How long a picture that did not load is left alone before a newly drawn slide asks for it again. */
const ASK_AGAIN_MS = 10_000
/** When each address last failed, so the stage, the strip and the next turn of the slide do not each ask again. */
const failedAt = new Map<string, number>()
const failedLately = (src: string) => Date.now() - (failedAt.get(src) ?? -Infinity) < ASK_AGAIN_MS

/** When the door was last asked whether this page's ticket still stands. */
let knockedAt = -Infinity

/**
 * A picture from this app's own door did not load: ask the door whether this
 * page's ticket still stands.
 *
 * An `<img>` cannot say why it failed. When the server has started again
 * under an open page, every picture's address carries a ticket the new server
 * refuses, and nothing else on the page asks anything for a while — so the
 * deck sat there with boxes where its figures were until somebody reloaded.
 * This asks the same door with the ticket in the header, through the
 * protocol's `ask`: a refusal of the ticket is what tells the page it is older
 * than its server, and the cover reloads it. A picture that is simply not
 * there answers 404 and nothing changes. Asked at most once in a while,
 * however many pictures a slide has.
 */
export function knock(src: string): void {
  if (!src.startsWith(`.${PATHS.asset}?`) || Date.now() - knockedAt < ASK_AGAIN_MS) return
  knockedAt = Date.now()
  void ask(PATHS.asset, { query: { path: '' }, ticket: true }).catch(() => {
    /* Nothing answered: `ask` has already said so to whatever draws the cover. */
  })
}

/** A picture on a slide, from the project when its path is relative to it. */
function Picture({ src, ...rest }: ComponentProps<'img'>) {
  const project = useContext(PictureProject)
  const from = typeof src === 'string' && isProjectPath(src) ? assetUrl(src, project) : src
  /* Keyed by the address: whether it failed is a fact about that address, not about this place on the slide. */
  return <Fetched key={typeof from === 'string' ? from : ''} {...rest} src={from} written={typeof src === 'string' ? src : ''} />
}

/**
 * One that is missing or refused is drawn as a box with its alt text (or the
 * path as written, when it has none) where the picture would be, and is not
 * asked for again by this element.
 */
function Fetched({ src, alt, written, ...rest }: ComponentProps<'img'> & { written: string }) {
  const [gone, setGone] = useState(() => typeof src === 'string' && failedLately(src))
  if (gone) {
    return (
      <span role="img" aria-label={alt || 'missing picture'} data-testid="picture-missing" className="slide-picture-missing">
        {alt || written}
      </span>
    )
  }
  return (
    <img
      {...rest}
      src={src}
      alt={alt ?? ''}
      onError={() => {
        if (typeof src === 'string') {
          failedAt.set(src, Date.now())
          knock(src)
        }
        setGone(true)
      }}
    />
  )
}

/** Is this a project-relative path rather than a URL? */
export function isProjectPath(src: string): boolean {
  return !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(src)
}

const REMARK: PluggableList = [remarkGfm, remarkMath]
/* Fenced code with a language is highlighted; without one it is left plain rather than guessed. */
const REHYPE: PluggableList = [rehypeKatex, [rehypeHighlight, { detect: false }]]

const COMPONENTS: Components = {
  img: ({ node: _node, ...rest }) => <Picture {...rest} />,
  a: ({ node: _node, href, ...rest }) =>
    typeof href === 'string' && href.startsWith(CITE_HREF) ? (
      <CiteMark label={href.slice(CITE_HREF.length)} />
    ) : (
      <a {...rest} href={href} target="_blank" rel="noreferrer" />
    ),
}

/**
 * A slide's Markdown, with GFM tables and task lists, `$math$` through KaTeX,
 * and fenced code highlighted. Memoised on the text, so a deck re-parsed on
 * every keystroke only re-renders the slides whose text changed.
 */
export const SlideMarkdown = memo(function SlideMarkdown({ text }: { text: string }) {
  return (
    <Markdown
      remarkPlugins={REMARK}
      rehypePlugins={REHYPE}
      components={COMPONENTS}
      urlTransform={(url) => (url.startsWith('data:image/') ? url : defaultUrlTransform(url))}
    >
      {text}
    </Markdown>
  )
})
