/**
 * The keys an update has to be signed with, on Windows and Linux: their
 * public halves, in PEM (`updateSignature.js`). The private half of the
 * first is the release environment's `UPDATE_SIGNING_KEY`; the second is a
 * spare, its private half kept off GitHub, to change to should the first be
 * lost or get out.
 *
 * With none, updates would be checked as they were before, against the
 * release's own hash. With these, every release has to be signed, or, once
 * an unsigned update is refused (`UPDATE_CHECK`), the apps built with them
 * take no more updates: the release workflow refuses to build one it can't
 * sign with a key listed here.
 *
 * A key is taken out only once no app still in use was built before its
 * replacement went in: an app can only check with the keys it has.
 *
 * @type {string[]}
 */
export const UPDATE_KEYS = [
  // In use since 17 Nov 2026.
  `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE07G29yqmrZngfR7TS7qpdLx5Fmio
1RssPnyN4uyEDvPghVkwxKORLmCCZ12H0WzVl8ZrL86lN5cNgXyyFnSHHg==
-----END PUBLIC KEY-----`,
  // The spare.
  `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEagSuotRZenC9DX97H5xoOPRlO/li
qfRM/POHKFpkL+IdhfKhsjRdUwEP+dCv4LPyv5LrUbgyd2KhR/GRQ/yuEA==
-----END PUBLIC KEY-----`,
]

/**
 * What becomes of an update that isn't signed as ours. `warn`: it is offered
 * all the same, and the app's log says what was wrong with it. `refuse`: it
 * is never offered, so never installed.
 *
 * `warn` for the first releases that check, so that a mistake in the check,
 * on a system it was never run on, costs nobody their updates. To be made
 * `refuse` once an update has been seen to pass on Windows and on Linux: the
 * log says `signed as ours` when one does.
 *
 * @type {'warn'|'refuse'}
 */
export const UPDATE_CHECK = 'warn'
