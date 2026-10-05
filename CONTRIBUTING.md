# Contributing

Patches are welcome, and a change sent here is worth more than the same
change kept on a fork: it gets maintained, and everyone gets it. Small
fixes can go straight to a pull request. For anything larger, open an
issue first so the design is agreed before the work is done. The design
notes under `.llm/` show where things are heading.

## Working on the code

Everything runs from `app/`:

    npm install
    npm run dev        # http://localhost:5173
    npm run ci         # lint, format check, type check, tests
    npm run ci:fix     # fix what the linter and formatter can

`npm run ci` must pass before a pull request is ready. The project is
plain JavaScript checked with JSDoc types, so new functions carry JSDoc
and `npm run typecheck` treats a type error as an error. Tests live in
`app/test/` and mirror `app/src/`. Module-level documentation is
generated with `npm run docs`; regenerate it when a documented module
changes.

Changes made with an AI assistant are fine; most of this codebase was.
You are still the author of what you submit, and the sign-off below
covers it the same way.

## The license of a contribution

InkSprite is released under the GNU Affero General Public License,
version 3 or later (`LICENSE`). Contributions come in under different
terms, and you should know what they are and why before you send one.

**By submitting a contribution you license it under the Apache License,
Version 2.0.** You keep the copyright. The grant is non-exclusive, so you
can use your own work anywhere else, under any terms you like. The
project combines it with the rest of InkSprite and releases the whole
under the AGPL.

The reason is to keep the project's options open without having to
find and ask every past contributor. Apache-2.0 allows sublicensing, so
the maintainers can do with the whole what they can already do with
their own part of it: sell builds, and change the license of a future
version if that ever becomes necessary. What is intended, and what the
inbound license makes possible, are not the same thing, so here is the
intent in plain terms:

- InkSprite stays free to use and its source stays public and
  modifiable. If the license ever changes, it will be to keep that true
  while stopping something specific, not to close the code.
- A version released under the AGPL stays under the AGPL. Nothing can
  be taken back.
- Paid builds are the same code. Paying is for the packaged build and
  to support the work, not for features withheld from the source.

If you are not comfortable with that, keep your change on a fork under
the AGPL, which the license fully allows.

## Sign-off

Every commit in a pull request carries a `Signed-off-by` trailer:

    Signed-off-by: Your Name <you@example.com>

`git commit -s` adds it. A consistent pseudonym is fine. The sign-off
states two things: that you have the
right to submit the change, in the sense of the [Developer Certificate
of Origin](https://developercertificate.org/), and that you submit it
under the terms in the section above. CI checks that the trailer is on
every commit and fails the pull request if one is missing.

## What the license does not cover

The InkSprite name and logo are not part of the license; see the README.
Your own writing is never part of it: what you write, generate or import
with InkSprite is yours.
