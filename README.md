# inksprite

A writing app with AI built in. It runs entirely in your browser: your
projects stay on your device, and AI requests go straight from the browser
to the provider you choose — OpenRouter, a model on your own machine, or any
OpenAI-compatible endpoint.

## Running it

```bash
cd app
npm install
npm run dev
```

`npm run build` writes a static site to `app/dist/`. A build sends no
analytics unless it is built with `VITE_VERCEL_ANALYTICS=true`.

## Contributing

Patches are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) has the setup, the
sign-off rule, and the terms a contribution comes in under: you keep your
copyright and license it under Apache-2.0, and the project releases the whole
under the AGPL. Read that section before your first pull request.

## License

inksprite is free software under the
[GNU Affero General Public License, version 3 or later](LICENSE).
Copyright © 2025–2026 The inksprite Authors.

In practice: use it, read it, change it, share it. If you distribute a
changed version, or run one that other people use over a network, you must
offer them its source under the same terms. Selling copies is allowed, by
anyone, and so is building it yourself for free.

**Your writing is yours.** The license covers the app, not what you make
with it. Nothing you write, generate, or import with inksprite is affected
by it.

### Icons and the font

The icons are from the [Noun Project](https://thenounproject.com), each
under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) by its
creator, and the X Typewriter font is under the SIL Open Font License 1.1.
Neither is covered by the AGPL. [CREDITS.md](CREDITS.md) lists them, and the
app credits them under Settings › About; a build of your own that keeps
them must keep their credits too.

### The name and the logo

The inksprite name and the logo are not covered by the license; all rights to
them are reserved. In this repository the logo is the set of `inksprite*`,
`favicon*`, `apple-touch-icon*` and `web-app-manifest-*` files under
`app/public/` and `docs/public/`, and the desktop app's icons in
`app/src-tauri/icons/`.

Only this project distributes builds under that name and mark. If you
distribute a build of your own, changed or not, give it your own name and
icon. You may say it is derived from inksprite, and the code stays under
the AGPL as before; what you may not do is present it as inksprite or as
endorsed by the project.
