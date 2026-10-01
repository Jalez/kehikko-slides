import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import 'katex/dist/katex.min.css'
import './index.css'

/* For its side effect: installs the mailbox before React mounts, so a host's
   greeting that arrives early is held rather than lost. */
import 'roadmap-module-protocol/client'
import { App } from './app.tsx'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
