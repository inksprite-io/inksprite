/**
 * A link's address, as the terminal shows it at its foot while the pointer
 * is on the link, the way a browser does.
 *
 * A program can print a link whose words are one address and which leads to
 * another, so the writer is shown where a click would take them. What is
 * shown is the address as a browser would go to it: a name written in
 * letters that only look like another's comes out in its own spelling, and
 * nothing in it can turn the line round or run off it unseen, since all of
 * it is plain ASCII.
 */

/**
 * The longest address put in the line, in characters. The line itself cuts
 * what its width can't hold; this keeps a megabyte out of the page.
 */
const MOST = 2000

/**
 * What to show for a link's address, or nothing for one that isn't an
 * address.
 *
 * @param {unknown} url
 * @returns {string}
 */
export function shownAddress(url) {
  if (typeof url !== 'string') return ''
  try {
    return new URL(url).href.slice(0, MOST)
  } catch {
    return ''
  }
}
