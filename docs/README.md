# docs.inksprite.io

The documentation site, built with [Starlight](https://starlight.astro.build).

The guide is being rewritten. Until it is, the site is a single page,
`src/content/docs/about.md`: privacy, the terms of service and the credits.
Every page the old guide had redirects there (see `astro.config.mjs`), since
the app and old posts still link to some of them.

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # the static site, in dist/
```
