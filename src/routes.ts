/**
 * Which page this document is. One document is served at `/app` and `/print`
 * (see vite.config.ts), so the route is read from the address: the screen
 * framed by a host, the presenter view (`/app?presenter=<deck>`), or the
 * print view (`/print?deck=<deck>`). The two windows of their own carry the
 * project, its id and the theme in the address, because no host is there to say them. The path
 * is where the project was when the window was opened; the id is what it is, and is how the window
 * finds the project again when the folder is renamed (`useProjectNow`).
 */
export type Route =
  | { page: 'screen' }
  | { page: 'presenter'; slug: string; project: string | null; projectId: string | null; theme: 'light' | 'dark' | null }
  | { page: 'print'; slug: string; project: string | null; projectId: string | null; theme: 'light' | 'dark' | null }

export function routeOf(href: string): Route {
  const url = new URL(href)
  const project = url.searchParams.get('project') || null
  const projectId = url.searchParams.get('projectId') || null
  const said = url.searchParams.get('theme')
  const theme = said === 'dark' || said === 'light' ? said : null
  const presenter = url.searchParams.get('presenter')
  if (/\/print\/?$/.test(url.pathname)) return { page: 'print', slug: url.searchParams.get('deck') ?? '', project, projectId, theme }
  if (presenter !== null) return { page: 'presenter', slug: presenter, project, projectId, theme }
  return { page: 'screen' }
}
