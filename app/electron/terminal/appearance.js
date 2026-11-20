/**
 * How the terminal looks: the colours and the size of its text, which the
 * app's page hands the frame so that it sits in the chat panel as a chat
 * does, in the light or the dark.
 *
 * The page is not trusted with more than that. What it sends is read here
 * field by field, and anything that isn't a colour or a size is left as it
 * was. Nor is it trusted to choose colours nobody could read: text the
 * colour of its ground is a terminal the writer can't see, however large it
 * is on the screen. So a pair of colours too close to each other is not
 * taken, and whether the terminal is dark or light is read off the ground
 * itself, not taken from the page's word.
 */

/**
 * @typedef {Object} Appearance
 * @property {boolean} dark - Whether the ground is darker than the text
 * @property {string} background - As `#rrggbb`
 * @property {string} foreground - As `#rrggbb`
 * @property {number} fontSize - In pixels
 */

/** @type {Appearance} */
export const DEFAULT_APPEARANCE = Object.freeze({
  dark: false,
  background: '#ffffff',
  foreground: '#1f2328',
  fontSize: 13,
})

/** The fonts the terminal is set in: the system's own fixed-width one first. */
export const FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace'

const COLOR = /^#[0-9a-f]{6}$/i

/**
 * The least contrast between the text and its ground, as WCAG counts it,
 * from 1 for the same colour to 21 for black on white: what it asks of
 * text to be read.
 */
export const LEAST_CONTRAST = 4.5

/**
 * How light a colour is to the eye, from 0 for black to 1 for white: WCAG's
 * relative luminance.
 *
 * @param {string} color - As `#rrggbb`
 * @returns {number}
 */
function lightness(color) {
  const [red, green, blue] = [1, 3, 5].map(at => {
    const part = parseInt(color.slice(at, at + 2), 16) / 255
    return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/**
 * The contrast between two colours, as WCAG counts it.
 *
 * @param {string} one - As `#rrggbb`
 * @param {string} other - As `#rrggbb`
 * @returns {number} From 1 to 21
 */
export function contrast(one, other) {
  const [lighter, darker] = [lightness(one), lightness(other)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * A colour as given, if it is one.
 *
 * @param {unknown} given
 * @returns {string|null} As `#rrggbb`, in lower case
 */
const colorFrom = given =>
  typeof given === 'string' && COLOR.test(given) ? given.toLowerCase() : null

/**
 * What a program's sixteen colours are drawn as, on a dark ground and on a
 * light one: each dark or light enough to be read there.
 */
const PALETTES = {
  dark: {
    black: '#2e3440',
    red: '#f47067',
    green: '#57ab5a',
    yellow: '#c69026',
    blue: '#6cb6ff',
    magenta: '#dcbdfb',
    cyan: '#56d4dd',
    white: '#c9d1d9',
    brightBlack: '#768390',
    brightRed: '#ff938a',
    brightGreen: '#6bc46d',
    brightYellow: '#daaa3f',
    brightBlue: '#96d0ff',
    brightMagenta: '#e8d2ff',
    brightCyan: '#76e3ea',
    brightWhite: '#f0f6fc',
  },
  light: {
    black: '#24292f',
    red: '#cf222e',
    green: '#116329',
    yellow: '#7d4e00',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#6e7781',
    brightBlack: '#57606a',
    brightRed: '#a40e26',
    brightGreen: '#1a7f37',
    brightYellow: '#633c01',
    brightBlue: '#218bff',
    brightMagenta: '#a475f9',
    brightCyan: '#3192aa',
    brightWhite: '#8c959f',
  },
}

/**
 * An appearance with what was given laid over it, each field only if it is
 * what the field holds, and the two colours only if the text can be read on
 * the ground they make.
 *
 * @param {any} given
 * @param {Appearance} [base]
 * @returns {Appearance}
 */
export function appearanceFrom(given, base = DEFAULT_APPEARANCE) {
  const next = { ...base }
  if (typeof given !== 'object' || given === null) return next
  const background = colorFrom(given.background) ?? base.background
  const foreground = colorFrom(given.foreground) ?? base.foreground
  if (contrast(background, foreground) >= LEAST_CONTRAST) {
    next.background = background
    next.foreground = foreground
    next.dark = lightness(background) < lightness(foreground)
  }
  if (Number.isFinite(given.fontSize) && given.fontSize >= 8 && given.fontSize <= 32) {
    next.fontSize = given.fontSize
  }
  return next
}

/**
 * The appearance a frame's address names, as the page wrote it there for the
 * first paint: `?background=ffffff&foreground=1f2328&fontSize=13`. The page
 * writes `dark` there too, which is not read.
 *
 * @param {URLSearchParams} params
 * @returns {Appearance}
 */
export function appearanceOf(params) {
  const colour = (/** @type {string} */ name) =>
    params.has(name) ? `#${params.get(name)}` : undefined
  return appearanceFrom({
    background: colour('background'),
    foreground: colour('foreground'),
    fontSize: params.has('fontSize') ? Number(params.get('fontSize')) : undefined,
  })
}

/**
 * The emulator's theme for an appearance.
 *
 * @param {Appearance} appearance
 * @returns {Record<string, string>}
 */
export function themeFor({ dark, background, foreground }) {
  return {
    ...PALETTES[dark ? 'dark' : 'light'],
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: dark ? '#3a5a8c' : '#b6d4fe',
    selectionInactiveBackground: dark ? '#3a4352' : '#dde3ea',
  }
}
