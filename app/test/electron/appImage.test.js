// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  execArgument,
  launcherEntry,
  plainName,
  settleAppImage,
} from '../../electron/src/appImage.js'

/** The entry electron-builder packs into the AppImage, as it was built. */
const PACKED = `[Desktop Entry]
Name=inksprite
Exec=AppRun --no-sandbox %U
Terminal=false
Type=Application
Icon=inksprite
StartupWMClass=inksprite
X-AppImage-Version=0.1.0
Comment=A writing app with AI built in
Categories=Office;
`

describe('plainName', () => {
  it('drops a release version, with its suffix', () => {
    expect(plainName('inksprite-0.1.0-dev.31-linux-x86_64.AppImage')).toBe(
      'inksprite-linux-x86_64.AppImage'
    )
    expect(plainName('inksprite-0.2.0-linux-arm64.AppImage')).toBe('inksprite-linux-arm64.AppImage')
  })

  it('leaves a name with no version alone', () => {
    expect(plainName('inksprite-linux-x86_64.AppImage')).toBeNull()
    expect(plainName('inksprite.AppImage')).toBeNull()
    expect(plainName('my inksprite 2.AppImage')).toBeNull()
  })
})

describe('execArgument', () => {
  it('quotes a path, with spaces kept', () => {
    expect(execArgument('/home/me/My Apps/inksprite.AppImage')).toBe(
      '"/home/me/My Apps/inksprite.AppImage"'
    )
  })

  it('escapes what quoting reserves, then the backslashes, and doubles a percent', () => {
    expect(execArgument('/a"b`c$d\\e%f')).toBe('"/a\\\\"b\\\\`c\\\\$d\\\\\\\\e%%f"')
  })
})

describe('launcherEntry', () => {
  it('starts the AppImage file, without a forced --no-sandbox', () => {
    const entry = launcherEntry(PACKED, '/home/me/Applications/inksprite-linux-x86_64.AppImage')
    expect(entry).toContain('Exec="/home/me/Applications/inksprite-linux-x86_64.AppImage" %U\n')
    expect(entry).toContain('TryExec=/home/me/Applications/inksprite-linux-x86_64.AppImage\n')
    expect(entry).not.toContain('AppRun')
    expect(entry).not.toContain('--no-sandbox')
    expect(entry).toContain('Comment=A writing app with AI built in')
    expect(entry.startsWith('[Desktop Entry]\nName=inksprite\nExec=')).toBe(true)
  })

  it("leaves TryExec out for a path it can't hold plainly", () => {
    expect(launcherEntry(PACKED, '/home/me/My Apps/inksprite.AppImage')).not.toContain('TryExec')
  })

  it('makes an entry of its own when none was packed', () => {
    const entry = launcherEntry('', '/opt/inksprite.AppImage')
    expect(entry).toContain('[Desktop Entry]\nName=inksprite\nExec="/opt/inksprite.AppImage" %U')
    expect(entry).toContain('Icon=inksprite')
    expect(entry).toContain('StartupWMClass=inksprite')
  })
})

describe('settleAppImage', () => {
  /** @type {string} */
  let root
  /** @type {string} */
  let apps
  /** @type {string} */
  let inside
  /** @type {string} */
  let home

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'appimage-'))
    apps = join(root, 'Applications')
    inside = join(root, 'mount')
    home = join(root, 'home')
    await mkdir(apps)
    await mkdir(join(inside, 'usr/share/icons/hicolor/512x512/apps'), { recursive: true })
    await writeFile(join(inside, 'inksprite.desktop'), PACKED)
    await writeFile(join(inside, 'usr/share/icons/hicolor/512x512/apps/inksprite.png'), 'png')
  })

  afterEach(async () => {
    await chmod(apps, 0o755).catch(() => {})
    await rm(root, { recursive: true, force: true })
  })

  /** Settle as the AppImage's own program, on a system with no package installed. */
  const settle = (env, more = {}) =>
    settleAppImage({
      env,
      home,
      running: join(inside, 'inksprite'),
      system: [join(root, 'usr/share/applications')],
      ...more,
    })

  /** An AppImage of `name` in the Applications folder, and its environment. */
  const appImage = async name => {
    const file = join(apps, name)
    await writeFile(file, 'appimage')
    return { APPIMAGE: file, APPDIR: inside }
  }

  it('does nothing unless the app runs as an AppImage', async () => {
    expect(await settle({})).toEqual([])
    await expect(stat(join(home, '.local'))).rejects.toThrow()
  })

  it('drops the version from its name, and tells the updater where it is now', async () => {
    const env = await appImage('inksprite-0.1.0-dev.31-linux-x86_64.AppImage')
    await settle(env)
    expect(env.APPIMAGE).toBe(join(apps, 'inksprite-linux-x86_64.AppImage'))
    expect(await readFile(env.APPIMAGE, 'utf8')).toBe('appimage')
    await expect(stat(join(apps, 'inksprite-0.1.0-dev.31-linux-x86_64.AppImage'))).rejects.toThrow()
  })

  it('keeps its name where a file has the plain one already', async () => {
    await writeFile(join(apps, 'inksprite-linux-x86_64.AppImage'), 'another')
    const env = await appImage('inksprite-0.1.0-dev.31-linux-x86_64.AppImage')
    await settle(env)
    expect(env.APPIMAGE).toBe(join(apps, 'inksprite-0.1.0-dev.31-linux-x86_64.AppImage'))
    expect(await readFile(join(apps, 'inksprite-linux-x86_64.AppImage'), 'utf8')).toBe('another')
  })

  it('writes its launcher entry and icon into the home folder', async () => {
    const env = await appImage('inksprite-0.1.0-dev.31-linux-x86_64.AppImage')
    const done = await settle(env)
    const entry = await readFile(join(home, '.local/share/applications/inksprite.desktop'), 'utf8')
    expect(entry).toContain(`Exec="${join(apps, 'inksprite-linux-x86_64.AppImage')}" %U`)
    expect(
      await readFile(join(home, '.local/share/icons/hicolor/512x512/apps/inksprite.png'), 'utf8')
    ).toBe('png')
    expect(done).toEqual([
      'renamed to inksprite-linux-x86_64.AppImage',
      'icon 512x512',
      `launcher entry for ${join(apps, 'inksprite-linux-x86_64.AppImage')}`,
    ])
  })

  it('writes nothing the next time, when nothing has moved', async () => {
    const env = await appImage('inksprite-linux-x86_64.AppImage')
    await settle(env)
    expect(await settle(env)).toEqual([])
  })

  it('points the entry at where the file has moved to', async () => {
    const env = await appImage('inksprite-linux-x86_64.AppImage')
    await settle(env)
    const moved = join(root, 'elsewhere.AppImage')
    await writeFile(moved, 'appimage')
    expect(await settle({ APPIMAGE: moved, APPDIR: inside })).toEqual([
      `launcher entry for ${moved}`,
    ])
    const entry = await readFile(join(home, '.local/share/applications/inksprite.desktop'), 'utf8')
    expect(entry).toContain(`Exec="${moved}" %U`)
  })

  it('follows XDG_DATA_HOME', async () => {
    const env = {
      ...(await appImage('inksprite-linux-x86_64.AppImage')),
      XDG_DATA_HOME: join(root, 'data'),
    }
    await settle(env)
    expect(await stat(join(root, 'data/applications/inksprite.desktop'))).toBeTruthy()
  })

  it("still makes its entry where it can't rename itself", async () => {
    const env = await appImage('inksprite-0.1.0-dev.31-linux-x86_64.AppImage')
    await chmod(apps, 0o555)
    const done = await settle(env)
    // Root can rename in a folder it can't write to; anyone else can't.
    if (process.getuid?.() !== 0) {
      expect(done[0]).toMatch(/^not renamed: /)
      expect(env.APPIMAGE).toBe(join(apps, 'inksprite-0.1.0-dev.31-linux-x86_64.AppImage'))
    }
    expect(done.at(-1)).toMatch(/^launcher entry for /)
  })

  it("does nothing for a program that only inherited another AppImage's variables", async () => {
    const env = await appImage('inksprite-0.1.0-dev.31-linux-x86_64.AppImage')
    expect(await settle(env, { running: '/opt/inksprite/inksprite' })).toEqual([])
    expect(env.APPIMAGE).toBe(join(apps, 'inksprite-0.1.0-dev.31-linux-x86_64.AppImage'))
    await expect(stat(join(home, '.local'))).rejects.toThrow()
  })

  it('writes no entry of its own where the package has one, which it would hide', async () => {
    await mkdir(join(root, 'usr/share/applications'), { recursive: true })
    await writeFile(join(root, 'usr/share/applications/inksprite.desktop'), '[Desktop Entry]\n')
    const env = await appImage('inksprite-linux-x86_64.AppImage')
    expect(await settle(env)).toEqual([])
    await expect(stat(join(home, '.local/share/applications/inksprite.desktop'))).rejects.toThrow()
  })

  it('takes away the entry it wrote once the package is installed', async () => {
    const env = await appImage('inksprite-linux-x86_64.AppImage')
    await settle(env)
    await mkdir(join(root, 'usr/share/applications'), { recursive: true })
    await writeFile(join(root, 'usr/share/applications/inksprite.desktop'), '[Desktop Entry]\n')
    expect(await settle(env)).toEqual(['launcher entry left to the package'])
    await expect(stat(join(home, '.local/share/applications/inksprite.desktop'))).rejects.toThrow()
  })

  it("leaves the person's own entry for the package alone", async () => {
    await mkdir(join(root, 'usr/share/applications'), { recursive: true })
    await writeFile(join(root, 'usr/share/applications/inksprite.desktop'), '[Desktop Entry]\n')
    const theirs = '[Desktop Entry]\nName=inksprite\nExec=/opt/inksprite/inksprite --x %U\n'
    await mkdir(join(home, '.local/share/applications'), { recursive: true })
    await writeFile(join(home, '.local/share/applications/inksprite.desktop'), theirs)
    await settle(await appImage('inksprite-linux-x86_64.AppImage'))
    expect(await readFile(join(home, '.local/share/applications/inksprite.desktop'), 'utf8')).toBe(
      theirs
    )
  })

  it('counts a folder reached through a link as the AppImage it is', async () => {
    const linked = join(root, 'linked-mount')
    await symlink(inside, linked)
    const env = { ...(await appImage('inksprite-linux-x86_64.AppImage')), APPDIR: linked }
    expect(await settle(env)).toEqual([
      'icon 512x512',
      `launcher entry for ${join(apps, 'inksprite-linux-x86_64.AppImage')}`,
    ])
  })

  it('keeps an entry the person changed, while it still starts this file', async () => {
    const env = await appImage('inksprite-linux-x86_64.AppImage')
    await settle(env)
    const at = join(home, '.local/share/applications/inksprite.desktop')
    const changed = (await readFile(at, 'utf8')).replace(' %U', ' --ozone-platform=wayland %U')
    await writeFile(at, changed)
    expect(await settle(env)).toEqual([])
    expect(await readFile(at, 'utf8')).toBe(changed)
  })
})
