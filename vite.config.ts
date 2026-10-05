import type { IncomingMessage } from 'node:http'
import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { LEGACY_WELL_KNOWN, WELL_KNOWN, legacyManifest } from 'kehikot-module-protocol'
import { frameAncestors, serves } from 'kehikot-module-protocol/serve'
import { defineConfig, type Plugin } from 'vite'

import { MANIFEST, TICKET, TICKET_HEADER, answer, stream } from './doors.ts'
import { ID, PREFERRED_PORT } from './manifest.ts'
import { page } from './page/document.ts'

/**
 * Every door, served by the process that serves the page. A module is ONE
 * ORIGIN: the host refuses an `entry` anywhere else, and a store on a second
 * port would make the page's own `/api` calls cross-origin.
 *
 * `/app` is claimed here before Vite's resolver sees it: under Vite dev an
 * extensionless `/app` next to `src/app.tsx` would otherwise answer with
 * compiled JavaScript, which a frame loads happily and runs nothing from.
 */
function doors(): Plugin {
  return {
    name: 'slides-doors',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const path = url.pathname
        const method = (request.method ?? 'GET').toUpperCase()

        const send = (status: number, body: unknown) => {
          response.statusCode = status
          if (body === null) return response.end()
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(JSON.stringify(body, null, 2))
        }

        if (path === WELL_KNOWN) return send(200, MANIFEST)

        /* The same manifest in the spelling a host from before the rename asks for. */
        if (path === LEGACY_WELL_KNOWN) return send(200, legacyManifest(MANIFEST))

        /* `/print` is the same page; it reads its address and draws the print view. */
        if (path === '/app' || path === '/app/' || path === '/' || path === '/print') {
          void server
            .transformIndexHtml(request.url ?? '/app', page(TICKET), request.originalUrl)
            .then((html) => {
              response.statusCode = 200
              response.setHeader('content-type', 'text/html; charset=utf-8')
              /* The ticket is per process; a cached page would have every write refused. */
              response.setHeader('cache-control', 'no-store')
              /* Framed by a host (`frameAncestors()`: KEHIKOT_ORIGINS, default every host origin here) or by nothing. */
              response.setHeader(
                'content-security-policy',
                frameAncestors(),
              )
              response.end(html)
            })
            .catch(next)
          return
        }

        const ours = path === '/healthz' || path === '/mcp' || path.startsWith('/api/')
        if (!ours) return next()

        /* The two live doors: server-sent events, held open until the page goes. */
        /* Events that arrive before the headers are sent (a talk's current state
           is handed over at once) wait for them. */
        const early: unknown[] = []
        let opened = false
        const event = (data: unknown) => response.write(`data: ${JSON.stringify(data)}\n\n`)
        const live = stream(method, path, url.searchParams, (data) => (opened ? event(data) : early.push(data)))
        if (live && 'reply' in live) return send(live.reply.status, live.reply.body)
        if (live) {
          response.statusCode = 200
          response.setHeader('content-type', 'text/event-stream; charset=utf-8')
          response.setHeader('cache-control', 'no-store')
          response.setHeader('connection', 'keep-alive')
          response.flushHeaders()
          response.write(': open\n\n')
          opened = true
          early.splice(0).forEach(event)
          /* A comment now and then, so nothing between here and the page decides the line is dead. */
          const beat = setInterval(() => response.write(': beat\n\n'), 25_000)
          request.on('close', () => {
            clearInterval(beat)
            live.close()
          })
          return
        }

        void body(request)
          .then((parsed) => {
            const reply = answer(method, path, url.searchParams, parsed, readTicket(request.headers[TICKET_HEADER]))
            if (!reply) return next()
            send(reply.status, reply.body)
          })
          .catch(next)
      })
    },
  }
}

function readTicket(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0] ?? null
  return null
}

/** The body of a write as a JSON object, or null. Bounded, because anything on this machine can find the port. */
const MAX_BODY_BYTES = 1_000_000

async function body(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes((request.method ?? 'GET').toUpperCase())) return null
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const piece = chunk as Buffer
    size += piece.length
    if (size > MAX_BODY_BYTES) return null
    chunks.push(piece)
  }
  if (!chunks.length) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * - No `server.cors`: the manifest declares storage, so the page is same-origin
 *   and a permissive CORS header would only let strangers read the ticket.
 * - No alias for `kehikot-module-protocol`: resolve it through its exports, as
 *   the host does. The `@` alias points inside this repo, for shadcn.
 * - No `server.port`: `serves()` (first, so it claims before anything else)
 *   decides it from PREFERRED_PORT and keeps the registration true.
 * - No build: the page is generated by the middleware above.
 * - `base: './'`, because a host frames this at whatever address it wrote down.
 */
export default defineConfig({
  base: './',
  plugins: [serves({ id: ID, prefer: PREFERRED_PORT }), doors(), react(), tailwindcss()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
})
