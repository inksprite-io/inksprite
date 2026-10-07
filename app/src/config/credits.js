/**
 * @module config/credits
 * @description Other people's work that ships with inksprite, and the credit
 * each asks for. Settings › About shows it in the app, and CREDITS.md at the
 * repository root says the same to a reader of the source; a test holds the
 * three together.
 *
 * The icons are from the Noun Project, under CC BY 3.0, which asks for the
 * title, the creator and the license wherever the icon is used. Each icon
 * component under `components/icons/` draws one of them, except the few
 * drawn for inksprite itself (`OWN_ICONS`); the SVG it came from is kept
 * under `public/static/icons/`, named for its number on the site.
 */

/**
 * @typedef {Object} IconCredit
 * @property {number} id - The icon's number on the Noun Project, as in its file name
 * @property {string} title - Its title there
 * @property {string} creator - Its creator's name there
 * @property {string} file - The SVG as downloaded, under `public/static/icons/`
 * @property {string[]} usedAs - What inksprite makes of it: icon components, or
 *   adapted copies; empty when nothing uses it yet
 */

/** @typedef {{ name: string, url: string }} License */

/** @type {License} */
export const ICON_LICENSE = {
  name: 'CC BY 3.0',
  url: 'https://creativecommons.org/licenses/by/3.0/',
}

/** @type {readonly IconCredit[]} */
export const ICON_CREDITS = Object.freeze([
  {
    id: 6393006,
    title: 'AI',
    creator: 'Waleed Elagamy',
    file: 'noun-ai-6393006.svg',
    usedAs: ['AiIcon'],
  },
  {
    id: 6447727,
    title: 'AI',
    creator: 'Waleed Elagamy',
    file: 'noun-ai-6447727.svg',
    usedAs: ['AiNetworkIcon'],
  },
  {
    id: 6480915,
    title: 'AI',
    creator: 'Palash Jain',
    file: 'noun-ai-6480915.svg',
    usedAs: ['AiSparklesIcon'],
  },
  {
    id: 7632949,
    title: 'ai message',
    creator: 'Glyphy',
    file: 'noun-ai-message-7632949.svg',
    usedAs: ['AiMessageIcon'],
  },
  {
    id: 4388762,
    title: 'books',
    creator: 'denimao',
    file: 'noun-books-4388762.svg',
    usedAs: ['BooksIcon'],
  },
  {
    id: 8002203,
    title: 'chat',
    creator: 'Vector Place',
    file: 'noun-chat-8002203.svg',
    usedAs: ['ChatIcon'],
  },
  {
    id: 8004645,
    title: 'chat',
    creator: 'Dwi ridwanto',
    file: 'noun-chat-8004645.svg',
    usedAs: ['ChatBubbleIcon'],
  },
  {
    id: 1577616,
    title: 'Clapperboard',
    creator: 'Ayub Irawan',
    file: 'noun-clapperboard-1577616.svg',
    usedAs: ['SceneIcon'],
  },
  {
    id: 7940133,
    title: 'Clapperboard',
    creator: 'Anamika singh',
    file: 'noun-clapperboard-7940133.svg',
    usedAs: [],
  },
  {
    id: 5498091,
    title: 'dock bottom',
    creator: 'Gregor Cresnar',
    file: 'noun-dock-bottom-5498091.svg',
    usedAs: [],
  },
  {
    id: 3010895,
    title: 'Electronics',
    creator: 'Fauzan Adiima',
    file: 'noun-electronics-3010895.svg',
    usedAs: ['ChipIcon'],
  },
  {
    id: 381125,
    title: 'Electronics',
    creator: 'Marie Van den Broeck',
    file: 'noun-electronics-381125.svg',
    usedAs: ['ElectronicsIcon'],
  },
  {
    id: 446783,
    title: 'Full Screen',
    creator: 'Ruben Semedo',
    file: 'noun-full-screen-446783.svg',
    usedAs: ['FullScreenIcon'],
  },
  {
    id: 3674578,
    title: 'in process',
    creator: 'Laura',
    file: 'noun_inprocess_3674578.svg',
    usedAs: ['InProcessIcon'],
  },
  {
    id: 1554694,
    title: 'Library',
    creator: 'Rich Paul',
    file: 'noun-library-1554694.svg',
    usedAs: ['LibraryIcon'],
  },
  {
    id: 4243101,
    title: 'Magic Book',
    creator: 'Juicy Fish',
    file: 'noun-magic-book-4243101.svg',
    usedAs: ['MagicBookIcon'],
  },
  {
    id: 7640296,
    title: 'Magic Book',
    creator: 'Icon Set',
    file: 'noun-magic-book-7640296.svg',
    usedAs: ['MagicBookAltIcon'],
  },
  {
    id: 4420245,
    title: 'magic books',
    creator: 'Alice Noir',
    file: 'noun-magic-books-4420245.svg',
    usedAs: ['magic-books-light.svg', 'magic-books-dark.svg'],
  },
  {
    id: 5498011,
    title: 'navigation menu',
    creator: 'Gregor Cresnar',
    file: 'noun-navigation-menu-5498011.svg',
    usedAs: ['NavigationMenuIcon'],
  },
  {
    id: 2762314,
    title: 'open book',
    creator: 'b farias',
    file: 'noun-open-book-2762314.svg',
    usedAs: [],
  },
  {
    id: 2762478,
    title: 'open book',
    creator: 'b farias',
    file: 'noun-open-book-2762478.svg',
    usedAs: ['BookIcon'],
  },
  {
    id: 6871999,
    title: 'Pen',
    creator: 'LAFS',
    file: 'noun-pen-6871999.svg',
    usedAs: ['PenIcon'],
  },
  {
    id: 1809808,
    title: 'Plus',
    creator: 'sumhi_icon',
    file: 'noun-plus-1809808.svg',
    usedAs: ['PlusIcon'],
  },
  {
    id: 4621962,
    title: 'progressing',
    creator: 'Laura',
    file: 'noun_progressing_4621962.svg',
    usedAs: [],
  },
  {
    id: 3738525,
    title: 'scene',
    creator: 'Muslim,-',
    file: 'noun-scene-3738525.svg',
    usedAs: [],
  },
  {
    id: 7514150,
    title: 'setting',
    creator: 'Icon Master',
    file: 'noun-setting-7514150.svg',
    usedAs: ['SettingsIcon'],
  },
  {
    id: 5497891,
    title: 'side navigation',
    creator: 'Gregor Cresnar',
    file: 'noun-side-navigation-5497891.svg',
    usedAs: ['SideNavigationIcon'],
  },
  {
    id: 7247484,
    title: 'sketch',
    creator: 'Corner Pixel',
    file: 'noun-sketch-7247484.svg',
    usedAs: [],
  },
  {
    id: 6546320,
    title: 'stack books',
    creator: 'Dicky Prayudawanto',
    file: 'noun-stack-books-6546320.svg',
    usedAs: ['BookshelfIcon'],
  },
  {
    id: 569575,
    title: 'Stop',
    creator: 'Isma Ruiz',
    file: 'noun-stop-569575.svg',
    usedAs: ['StopIcon'],
  },
  {
    id: 7307076,
    title: 'storyboard',
    creator: 'ajat sudrajat',
    file: 'noun-storyboard-7307076.svg',
    usedAs: [],
  },
  {
    id: 7655500,
    title: 'storyboard',
    creator: 'Fahrul Saputra',
    file: 'noun-storyboard-7655500.svg',
    usedAs: ['StoryboardIcon'],
  },
  {
    id: 8002193,
    title: 'write',
    creator: 'Vector Place',
    file: 'noun-write-8002193.svg',
    usedAs: ['WriteIcon'],
  },
  {
    id: 6152090,
    title: 'write book',
    creator: 'Ayub Irawan',
    file: 'noun-write-book-6152090.svg',
    usedAs: ['WriteBookIcon'],
  },
])

/** Icon components drawn for inksprite itself, which credit nobody. */
export const OWN_ICONS = Object.freeze(['DatabaseIcon', 'RetryIcon', 'SendIcon', 'SpeakerIcon'])

/**
 * @typedef {Object} FontCredit
 * @property {string} name
 * @property {string} creator
 * @property {string} url - Where the font comes from
 * @property {License} license
 */

/** @type {readonly FontCredit[]} */
export const FONT_CREDITS = Object.freeze([
  {
    name: 'X Typewriter',
    creator: 'GGBotNet',
    url: 'https://ggbot.net',
    license: { name: 'SIL Open Font License 1.1', url: 'https://openfontlicense.org' },
  },
])

/**
 * An icon's page on the Noun Project.
 * @param {number} id
 * @returns {string}
 */
export function iconUrl(id) {
  return `https://thenounproject.com/icon/${id}/`
}
