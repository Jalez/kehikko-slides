import 'katex/dist/katex.min.css'
import './index.css'

/* For its side effect: installs the mailbox before React mounts, so a host's
   greeting that arrives early is held rather than lost. */
import 'kehikot-module-protocol/client'
import { mountPage } from 'kehikot-module-protocol/client/mount'
import { lazy, Suspense } from 'react'
import { routeOf } from './routes.ts'

/* One bundle, but a page loads only what its route draws: the audience view is a slide and a stream, and
   must not pull in the editor. */
const App = lazy(() => import('./app.tsx').then((m) => ({ default: m.App })))
const PresenterView = lazy(() => import('./presenter.tsx').then((m) => ({ default: m.PresenterView })))
const PrintView = lazy(() => import('./print.tsx').then((m) => ({ default: m.PrintView })))
const AudienceView = lazy(() => import('./audience.tsx').then((m) => ({ default: m.AudienceView })))

/* A window of its own has no host to say the theme; its address does (`?theme=`), and the page
   document has already put it on <html> before this runs. */
const route = routeOf(location.href)

mountPage(
  'root',
  <Suspense fallback={null}>
    {route.page === 'audience' ? (
      <AudienceView linkKey={route.key} />
    ) : route.page === 'presenter' ? (
      <PresenterView project={route.project} projectId={route.projectId} slug={route.slug} />
    ) : route.page === 'print' ? (
      <PrintView project={route.project} projectId={route.projectId} slug={route.slug} />
    ) : (
      <App />
    )}
  </Suspense>,
)
