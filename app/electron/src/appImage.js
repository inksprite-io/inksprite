/**
 * The Linux AppImage making itself at home. An AppImage is one file, and no
 * launcher lists it until a `.desktop` file names it, so on each start as an
 * AppImage the app:
 *
 * - drops the version from its file's name, as the release's version-less
 *   copy is called (`inksprite-linux-x86_64.AppImage`). The updater then
 *   writes each new version over it in place, rather than beside it under
 *   the new version's name, so the launcher's entry keeps pointing at it.
 * - writes its launcher entry and icon where launchers look for the person's
 *   own (`~/.local/share/applications` and `icons`), from the entry
 *   electron-builder packed inside it, pointing at where the file is now.
 *
 * Nothing is written that already says the same. The entry is named after the
 * app's `desktopName` (`inksprite.desktop`), which is how a desktop matches
 * the app's windows to it, and its `TryExec` hides it from launchers once the
 * file is gone (left out for a path with a space or a backslash in it, which
 * `TryExec` can't hold plainly). The install script (`install.sh`) removes both on
 * `--uninstall`.
 *
 * The .deb installs its own entry and icon, and never runs this.
 */

import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/** The app's name in its entry's file, its icon's and its windows' class. */
const NAME = 'inksprite'

/**
 * A file's name without its version: `inksprite-0.1.0-dev.31-linux-x86_64.AppImage`
 * is `inksprite-linux-x86_64.AppImage`. Null for one with no version in it.
 *
 * @param {string} name
 * @returns {string|null}
 */
export function plainName(name) {
  const plain = name.replace(/-\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?(?=-linux-)/, '')
  return plain === name ? null : plain
}

/**
 * A path as one argument of a `.desktop` file's `Exec`: in double quotes,
 * with what quoting reserves escaped, then the backslashes a desktop file's
 * strings escape, and `%` doubled, since it starts a field code.
 *
 * @param {string} file
 * @returns {string}
 */
export function execArgument(file) {
  const quoted = file
    .replace(/\\/g, '\\\\\\\\')
    .replace(/(["`$])/g, '\\\\$1')
    .replace(/%/g, '%%')
  return `"${quoted}"`
}

/**
 * The launcher entry for the AppImage at `file`: the one packed inside it,
 * started by that file instead of from inside it, and without its
 * `--no-sandbox`, which the AppImage's own start script adds only where the
 * system won't let the sandbox run.
 *
 * @param {string} packed - The entry electron-builder packed, or '' for none
 * @param {string} file - Where the AppImage is
 * @returns {string}
 */
export function launcherEntry(packed, file) {
  const kept = packed
    .split('\n')
    .filter(line => line.trim() !== '' && !/^(Exec|TryExec)=/.test(line))
  const lines =
    kept.length > 0
      ? kept
      : [
          '[Desktop Entry]',
          `Name=${NAME}`,
          'Type=Application',
          `Icon=${NAME}`,
          'Terminal=false',
          `StartupWMClass=${NAME}`,
        ]
  const at =
    Math.max(
      lines.findIndex(line => line.startsWith('Name=')),
      0
    ) + 1
  lines.splice(
    at,
    0,
    `Exec=${execArgument(file)} %U`,
    ...(/[\s\\]/.test(file) ? [] : [`TryExec=${file}`])
  )
  return `${lines.join('\n')}\n`
}

/**
 * Whether a file says `text` already.
 * @param {string} file
 * @param {string|Buffer} text
 */
async function says(file, text) {
  try {
    return (await readFile(file)).equals(Buffer.from(text))
  } catch {
    return false
  }
}

/** @param {string} file */
const exists = file =>
  stat(file).then(
    () => true,
    () => false
  )

/**
 * Settle the AppImage: its plain name, its launcher entry and its icon. Does
 * nothing unless the app is running as an AppImage. What can't be done (a
 * folder it can't write to) is left undone, and said in what it returns.
 *
 * @param {{env?: NodeJS.ProcessEnv, home?: string}} [where] - The environment,
 *   which names the AppImage and where it's unpacked (`APPIMAGE`, `APPDIR`),
 *   and the home folder
 * @returns {Promise<string[]>} What it did, and what it couldn't, for the log
 */
export async function settleAppImage({ env = process.env, home = homedir() } = {}) {
  const done = /** @type {string[]} */ ([])
  let file = env.APPIMAGE
  const inside = env.APPDIR
  if (!file || !inside || !path.isAbsolute(file) || /[\n\0]/.test(file)) return done

  const plain = plainName(path.basename(file))
  if (plain) {
    const renamed = path.join(path.dirname(file), plain)
    if (!(await exists(renamed))) {
      try {
        await rename(file, renamed)
        // The updater reads this when it installs, to know which file to replace.
        env.APPIMAGE = file = renamed
        done.push(`renamed to ${plain}`)
      } catch (error) {
        done.push(`not renamed: ${/** @type {Error} */ (error).message}`)
      }
    }
  }

  const data = env.XDG_DATA_HOME || path.join(home, '.local', 'share')
  try {
    const icons = path.join(inside, 'usr', 'share', 'icons', 'hicolor')
    for (const size of await readdir(icons).catch(() => [])) {
      const icon = path.join(icons, size, 'apps', `${NAME}.png`)
      if (!(await exists(icon))) continue
      const to = path.join(data, 'icons', 'hicolor', size, 'apps', `${NAME}.png`)
      if (await says(to, await readFile(icon))) continue
      await mkdir(path.dirname(to), { recursive: true })
      await copyFile(icon, to)
      done.push(`icon ${size}`)
    }
    const packed = await readFile(path.join(inside, `${NAME}.desktop`), 'utf8').catch(() => '')
    const entry = launcherEntry(packed, file)
    const to = path.join(data, 'applications', `${NAME}.desktop`)
    if (!(await says(to, entry))) {
      await mkdir(path.dirname(to), { recursive: true })
      await writeFile(to, entry)
      done.push(`launcher entry for ${file}`)
    }
  } catch (error) {
    done.push(`no launcher entry: ${/** @type {Error} */ (error).message}`)
  }
  return done
}
