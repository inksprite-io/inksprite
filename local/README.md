# Local material

Everything in this directory except this file is ignored by git. It holds
material used to try the app by hand that must not be published with it:
rulebooks, settings and adventures condensed from published games, raw
conversions of the same, and anything else that is not ours to redistribute.

Import a folder from here into a project to play it. Nothing under `app/`
reads this directory, so the app and the tests do not depend on what is
in it, and a fresh clone works without it.

For the harness, third-party fixtures live under `app/harness/test-cards/`
and `app/harness/test-chats/` instead, also ignored; the `real*.test.js`
suites skip when they are absent.
