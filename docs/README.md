# docs.inksprite.io

The documentation site, built with [Starlight](https://starlight.astro.build):
the guides (getting started, research, roleplay, narration), a page for each
feature, and the About page (privacy, the terms of service and the credits).
Every page the old guide had redirects to the page that covers it now (see
`astro.config.mjs`), since the app and old posts still link to some of them.

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # the static site, in dist/
```

## Screenshots and videos

The guides' pictures are taken from the app by a script, so they can be taken
again whenever the UI changes:

```bash
npm run capture
```

It needs the app's dependencies installed (`npm install` in `app/`). It starts
the app on a port of its own and, for each guide, opens it in a new browser
profile and does what the guide says: getting started in
`capture/walkthrough.js`, narration in `capture/narration.js`, roleplay in
`capture/roleplay.js`, research in `capture/research.js`, and the feature
pages' pictures in `capture/features.js`. It does each once in the light theme
and once in the dark, whose pictures' names end in `-dark`. The guide shows the ones in
the reader's theme, and a click on a screenshot shows it whole. Screenshots go
to `src/assets/guide/` and videos to `public/guide/`; `git status` then shows
which ones changed. A step that no longer works stops the run, with what the
page showed in `capture-failed.png`. `npm run capture -- --theme dark` takes
one theme only, and `npm run capture -- --guide narration` one guide.

OpenRouter, Anthropic, LM Studio and Kokoro are a stand-in
(`capture/stand-in.js`), with replies written for the guide and silence for
speech, so a run needs no account or model and comes out the same every time.
The roleplay and research guides replay sessions played once with a real model
(`capture/roleplay-game.json`, `capture/research-game.json`): the stand-in
gives back the model's replies, the app's tools run for real, and their dice
and a new comment's id are drawn as they were. The research guide's web
searches are answered from its recording with titles and addresses only.

Other people's files are downloaded on the first run into `capture/`, and
never committed: the narration guide's EPUB of *Frankenstein* from Project
Gutenberg, the roleplay guide's card and lorebook, and the research guide's
two papers. The feature pages' codebase is inksprite's own, as committed:
`git archive` copies what HEAD holds, without what stays private, so those
pictures change when the code they show does.
The MCP page's pictures connect to the real DeepWiki server for its tools,
the one thing a run reaches outside the app. Its recording
of the letter, `public/guide/frankenstein-letter-1.mp3`, was made by hand with
a real Kokoro. Videos are only replaced when what they show changes (their
fingerprints are in `public/guide/fingerprints.json`); a change that only
restyles a step in the middle of one shows in the screenshots, and
`npm run capture -- --videos` records them all again.

The repository's README shows two of the clips, as animated WebP in
`readme/`, since GitHub plays no video kept in a repository. A run makes one
again whenever it records its clip anew, and `npm run capture:readme` makes
them all again from the clips (`capture/readme.js` lists them).

To add a picture, take it in the guide's walkthrough with `ui.shot(name)` or
`ui.record(name, steps)`, and put it in the guide with
`<Screenshot name="…" alt="…" />` or `<Clip name="…" label="…" />`, which
find both themes' copies by the name.

### OpenRouter's own pages

The sign-up and authorize pages are OpenRouter's, and need an account, so they
have a script of their own, to run when OpenRouter changes them. It takes them
in both themes too:

```bash
npm run capture:openrouter
```

It signs in with an account made for the docs (never your own: its name shows
on the authorize page). The email and password go on two lines in
`.claude/openrouter-docs-key` at the repository root, which is gitignored; the
session is kept in `capture/.openrouter-session.json` for the next run. If
OpenRouter emails a code to confirm the sign-in, the run waits for it in
`capture/.openrouter-code`. Without the account it takes the sign-up page
alone.
