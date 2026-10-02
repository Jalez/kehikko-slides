import { memo } from 'react'
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { PluggableList } from 'unified'

import { CITE_HREF, CiteMark } from './citations.tsx'

/**
 * Where a picture a slide names is fetched from. A URL (`https:`, `data:`, an
 * absolute `/…`) is used as written; anything else is a path relative to the
 * project.
 *
 * TODO(assets): serve project files through the slides store and map a
 * project-relative path to that door here. Until then the path is used as is.
 */
export function assetUrl(path: string): string {
  return path
}

/** Is this a project-relative path rather than a URL? */
export function isProjectPath(src: string): boolean {
  return !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(src)
}

const REMARK: PluggableList = [remarkGfm, remarkMath]
/* Fenced code with a language is highlighted; without one it is left plain rather than guessed. */
const REHYPE: PluggableList = [rehypeKatex, [rehypeHighlight, { detect: false }]]

const COMPONENTS: Components = {
  img: ({ src, alt, node: _node, ...rest }) => (
    <img {...rest} src={typeof src === 'string' && isProjectPath(src) ? assetUrl(src) : src} alt={alt ?? ''} />
  ),
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
