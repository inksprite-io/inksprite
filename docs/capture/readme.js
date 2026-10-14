/**
 * The clips the repository's README shows, as animated WebP. GitHub plays no
 * video kept in a repository, but it shows an animated picture like any
 * other, and in the reader's theme, as the README's screenshots are.
 *
 *   npm run capture:readme      # from docs/: make them all again
 *
 * `npm run capture` makes one again whenever it records its clip anew. The
 * frames come out of the clip through the ffmpeg Playwright downloads for its
 * recordings, and sharp puts them together.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { homedir, platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'

const DOCS = fileURLToPath(new URL('..', import.meta.url))
const VIDEOS = join(DOCS, 'public', 'guide')

/** Where the README's animations go. */
const ANIMATIONS = join(DOCS, 'readme')

/** The clips the README shows, by name; each in both themes. */
export const README_CLIPS = ['research-comment', 'narration-generate']

/** Frames a second: enough for a pointer and typing, and few enough to keep it small. */
const FPS = 10

/** The ffmpeg in Playwright's downloads. */
function ffmpeg() {
  const home = homedir()
  const cache =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    {
      darwin: join(home, 'Library', 'Caches', 'ms-playwright'),
      win32: join(process.env.LOCALAPPDATA ?? home, 'ms-playwright'),
    }[platform()] ||
    join(home, '.cache', 'ms-playwright')
  const folder = existsSync(cache)
    ? readdirSync(cache)
        .filter(name => name.startsWith('ffmpeg-'))
        .sort()
        .at(-1)
    : undefined
  const file = folder && readdirSync(join(cache, folder)).find(name => name.startsWith('ffmpeg'))
  if (!folder || !file) throw new Error(`No ffmpeg in ${cache}: npx playwright install ffmpeg`)
  return join(cache, folder, file)
}

/**
 * `public/guide/<name>.webm` as `readme/<name>.webp`, looping.
 *
 * @param {string} name - The clip's file name without `.webm`, so `-dark` for the dark one
 */
export async function animate(name) {
  const frames = await mkdtemp(join(tmpdir(), 'inksprite-readme-'))
  try {
    execFileSync(ffmpeg(), [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      join(VIDEOS, `${name}.webm`),
      '-r',
      String(FPS),
      join(frames, '%04d.png'),
    ])
    const files = (await readdir(frames)).sort().map(file => join(frames, file))
    await mkdir(ANIMATIONS, { recursive: true })
    await sharp(files, { join: { animated: true } })
      // More effort, or minSize, saves a few percent at many times the time.
      .webp({ quality: 80, effort: 4, loop: 0, delay: files.map(() => 1000 / FPS) })
      .toFile(join(ANIMATIONS, `${name}.webp`))
  } finally {
    await rm(frames, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const clip of README_CLIPS) {
    for (const name of [clip, `${clip}-dark`]) {
      await animate(name)
      console.log(`  readme/${name}.webp`)
    }
  }
}
