import 'katex/dist/katex.min.css'
import './index.css'

/* For its side effect: installs the mailbox before React mounts, so a host's
   greeting that arrives early is held rather than lost. */
import 'kehikot-module-protocol/client'
import { mountPage } from 'kehikot-module-protocol/client/mount'
import { App } from './app.tsx'
import { PresenterView } from './presenter.tsx'
import { PrintView } from './print.tsx'
import { routeOf } from './routes.ts'

/* A window of its own has no host to say the theme; its address does (`?theme=`), and the page
   document has already put it on <html> before this runs. */
const route = routeOf(location.href)

mountPage(
  'root',
  route.page === 'presenter' ? (
    <PresenterView project={route.project} projectId={route.projectId} slug={route.slug} />
  ) : route.page === 'print' ? (
    <PrintView project={route.project} projectId={route.projectId} slug={route.slug} />
  ) : (
    <App />
  ),
)
