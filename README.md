# talkdom.org

Static documentation and examples for **talkDOM 0.5.0** (September 20, 2026).

The bundled `talkdom.js` is the released core source. Public CDN examples are pinned to the same version. `site.js` owns API-browser selection and registers the explicitly labeled site demos; it loads once on every page, including fragment navigation.

```sh
nvm use
npm ci
npm test
make css-prod
make serve
```

Open `http://localhost:3000`. Source fragments under `partials/` and the matching standalone page bodies must stay in sync. API browser categories and details live under `partials/browser/`. Its controller cancels superseded requests, ignores late responses, and restores the selected entry after Back/Forward.

Form/JSON bodies and loading keywords are custom application examples, not built-in 0.5.0 APIs. The docs include registration examples.

The regression suite covers fragment entry, reversed category/detail responses, failures and retries, history restoration, all reference entries, and the loading example.
