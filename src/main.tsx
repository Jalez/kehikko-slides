import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import 'katex/dist/katex.min.css'
import './index.css'

/* For its side effect: installs the mailbox before React mounts, so a host's
   greeting that arrives early is held rather than lost. */
import 'kehikot-module-protocol/client'
import { App } from './app.tsx'
import { PresenterView } from './presenter.tsx'
import { PrintView } from './print.tsx'
import { applyTheme, routeOf } from './routes.ts'

const route = routeOf(location.href)
if (route.page !== 'screen') applyTheme(route.theme)

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      {route.page === 'presenter' ? (
        <PresenterView project={route.project} slug={route.slug} />
      ) : route.page === 'print' ? (
        <PrintView project={route.project} slug={route.slug} />
      ) : (
        <App />
      )}
    </StrictMode>,
  )
}
