/**
 * Opening this module's own pages (presenter view, print view) in a window
 * of their own. They are plain loopback pages that sync through the slides
 * server, so the same URL works from any browser on the machine — which is
 * the fallback when a window cannot be opened from here (a blocked pop-up,
 * or the desktop app's web view, which has no handler for new windows).
 */

/** An address next to this page, the way the page reaches its own `/api`. */
export function pageUrl(path: string, params: Record<string, string>, base: string = location.href): string {
  const url = new URL(path, base)
  url.search = new URLSearchParams(params).toString()
  return url.href
}

/** Open `url` in a new window. False when nothing opened. */
export function openPage(url: string, open: typeof window.open = (...args) => window.open(...args)): boolean {
  try {
    return open(url, '_blank') !== null
  } catch {
    return false
  }
}
