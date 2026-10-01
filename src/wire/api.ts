/**
 * This module's own `/api`, as the page calls it. Relative paths, because the
 * page and the store are one origin. A write carries the ticket printed into
 * the page; see `TICKET` in doors.ts.
 */
const TICKET_HEADER = 'x-module-ticket'

function ticket(): string {
  const text = document.getElementById('ticket')?.textContent ?? '""'
  try {
    return String(JSON.parse(text))
  } catch {
    return ''
  }
}

export interface Api {
  read(projectPath: string): Promise<unknown>
  write(projectPath: string, value: unknown): Promise<void>
}

async function json(response: Response): Promise<{ ok?: boolean; value?: unknown; error?: string }> {
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; value?: unknown; error?: string }
  if (!response.ok || body.ok === false) throw new Error(body.error ?? `the store answered ${response.status}`)
  return body
}

export const api: Api = {
  async read(projectPath) {
    const response = await fetch(`./api/value?${new URLSearchParams({ projectPath })}`)
    return (await json(response)).value ?? null
  },
  async write(projectPath, value) {
    const response = await fetch('./api/value', {
      method: 'POST',
      headers: { 'content-type': 'application/json', [TICKET_HEADER]: ticket() },
      body: JSON.stringify({ projectPath, value }),
    })
    await json(response)
  },
}
