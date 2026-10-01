import { GlobalRegistrator } from '@happy-dom/global-registrator'

/* A document for the tests that render one; the pure tests do not care. */
GlobalRegistrator.register()

/* The page is a standards-mode document; happy-dom leaves `compatMode` unset,
   which KaTeX reads as quirks mode and warns about on every formula. */
if (document.compatMode !== 'CSS1Compat') Object.defineProperty(document, 'compatMode', { value: 'CSS1Compat' })
