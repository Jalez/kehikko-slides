/**
 * Which page this document is. One document is served at `/app` and `/print`
 * (see vite.config.ts), so the route is read from the address: the screen
 * framed by a host, the presenter view (`/app?presenter=<deck>`), or the
 * print view (`/print?deck=<deck>`). The two windows of their own carry the
 * project and theme in the address, because no host is there to say them.
 */
export type Route =
  | { page: 'screen' }
  | { page: 'presenter'; slug: string; project: string | null; theme: 'light' | 'dark' | null }
  | { page: 'print'; slug: string; project: string | null; theme: 'light' | 'dark' | null }

export function routeOf(href: string): Route {
  const url = new URL(href)
  const project = url.searchParams.get('project') || null
  const said = url.searchParams.get('theme')
  const theme = said === 'dark' || said === 'light' ? said : null
  const presenter = url.searchParams.get('presenter')
  if (/\/print\/?$/.test(url.pathname)) return { page: 'print', slug: url.searchParams.get('deck') ?? '', project, theme }
  if (presenter !== null) return { page: 'presenter', slug: presenter, project, theme }
  return { page: 'screen' }
}
