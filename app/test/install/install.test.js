// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises'
import { arch, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launcherEntry } from '../../electron/src/appImage.js'

/** The script inksprite.io/install serves. */
const SCRIPT = fileURLToPath(new URL('../../../docs/public/install', import.meta.url))

/** This computer's names, as the script and the release give them. */
const IMAGE = arch() === 'arm64' ? 'arm64' : 'x86_64'
const UPDATE = arch() === 'arm64' ? 'latest-linux-arm64.yml' : 'latest-linux.yml'
const BUILD = `inksprite-0.2.0-linux-${IMAGE}.AppImage`

/** The entry electron-builder packs into the AppImage. */
const PACKED = `[Desktop Entry]
Name=inksprite
Exec=AppRun --no-sandbox %U
Terminal=false
Type=Application
Icon=inksprite
StartupWMClass=inksprite
Comment=A writing app with AI built in
Categories=Office;
`

/**
 * A stand-in AppImage: a script that answers --appimage-extract as the real
 * runtime does, into ./squashfs-root, with the packed entry and an icon.
 */
const APPIMAGE = `#!/bin/sh
[ "$1" = --appimage-extract ] || exit 0
mkdir -p squashfs-root/usr/share/icons/hicolor/512x512/apps
case "$2" in
  *.png) printf png > squashfs-root/usr/share/icons/hicolor/512x512/apps/inksprite.png ;;
  inksprite.desktop) cat > squashfs-root/inksprite.desktop <<'EOF'
${PACKED}EOF
  ;;
esac
`

/** What the made-up release serves, by name. */
const files = new Map()
let server
let releases

/** The release's update file, listing `name` with `bytes`'s SHA-512. */
const updateFile = (name, bytes) =>
  `version: 0.2.0\nfiles:\n  - url: ${name}\n    sha512: ${createHash('sha512').update(bytes).digest('base64')}\n    size: ${bytes.length}\n`

beforeAll(async () => {
  server = createServer((request, response) => {
    const body = files.get(decodeURIComponent(request.url.slice(1)))
    response.writeHead(body === undefined ? 404 : 200)
    response.end(body)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  releases = `http://127.0.0.1:${server.address().port}`
})

afterAll(() => new Promise(resolve => server.close(resolve)))

let root
let home

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'install-'))
  home = join(root, 'home')
  await mkdir(home)
  files.clear()
  files.set(BUILD, Buffer.from(APPIMAGE))
  files.set(UPDATE, updateFile(BUILD, Buffer.from(APPIMAGE)))
})

afterEach(() => rm(root, { recursive: true, force: true }))

/** Run the script with these options; resolves to its exit code and output. */
const install = (args = [], env = {}) =>
  new Promise(resolve =>
    execFile(
      'sh',
      [SCRIPT, ...args],
      { env: { PATH: process.env.PATH, HOME: home, INKSPRITE_RELEASES: releases, ...env } },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr })
    )
  )

/** Where a program is on this system's PATH, or null. */
const which = tool =>
  new Promise(resolve =>
    execFile('sh', ['-c', `command -v ${tool}`], (error, stdout) =>
      resolve(error ? null : stdout.trim())
    )
  )

const exists = file =>
  stat(file).then(
    () => true,
    () => false
  )

describe.runIf(process.platform === 'linux')('the install script, on Linux', () => {
  it('installs the AppImage under its plain name, in the launcher with its icon', async () => {
    const { code, stdout } = await install(['--appimage'])
    expect(code).toBe(0)
    const file = join(home, 'Applications', `inksprite-linux-${IMAGE}.AppImage`)
    expect(await readFile(file, 'utf8')).toBe(APPIMAGE)
    expect((await stat(file)).mode & 0o111).not.toBe(0)
    expect(stdout).toContain(`inksprite 0.2.0 is in ${file}, and in your launcher.`)
    expect(
      await readFile(join(home, '.local/share/icons/hicolor/512x512/apps/inksprite.png'), 'utf8')
    ).toBe('png')
    // The same entry the app writes on each start, so its first finds nothing to change.
    expect(await readFile(join(home, '.local/share/applications/inksprite.desktop'), 'utf8')).toBe(
      launcherEntry(PACKED, file)
    )
  })

  it('quotes a folder with a space, a quote and a dollar sign as the app does', async () => {
    const dir = join(root, 'My "Apps" $HOME')
    expect((await install(['--appimage'], { INKSPRITE_DIR: dir })).code).toBe(0)
    const file = join(dir, `inksprite-linux-${IMAGE}.AppImage`)
    expect(await readFile(join(home, '.local/share/applications/inksprite.desktop'), 'utf8')).toBe(
      launcherEntry(PACKED, file)
    )
  })

  it("installs nothing from a download that isn't the file the release lists", async () => {
    files.set(BUILD, Buffer.from(`${APPIMAGE}# changed\n`))
    const { code, stderr } = await install(['--appimage'])
    expect(code).toBe(1)
    expect(stderr).toContain("isn't the file the release lists, so nothing was installed.")
    expect(await exists(join(home, 'Applications'))).toBe(false)
  })

  it('says so when the release has no build for the computer', async () => {
    files.set(UPDATE, updateFile('inksprite-0.2.0-linux-other.AppImage', Buffer.from('x')))
    const { code, stderr } = await install(['--appimage'])
    expect(code).toBe(1)
    expect(stderr).toContain('The latest release has no AppImage for this computer.')
  })

  it('installs nothing when the release lists no SHA-512 for the build', async () => {
    files.set(UPDATE, `version: 0.2.0\nfiles:\n  - url: ${BUILD}\n    size: 1\n`)
    const { code, stderr } = await install(['--appimage'])
    expect(code).toBe(1)
    expect(stderr).toContain('The release lists no SHA-512 for')
    expect(await exists(join(home, 'Applications'))).toBe(false)
  })

  it('installs nothing on a system with no tool to check the download', async () => {
    // Everything the script runs, but sha512sum and shasum.
    const bin = join(root, 'bin')
    await mkdir(bin)
    const tools = ['sh', 'curl', 'awk', 'sed', 'mktemp', 'rm', 'mkdir', 'chmod', 'mv', 'cp', 'cat']
    tools.push('od', 'tr', 'base64', 'uname', 'basename', 'dirname', 'id', 'env')
    for (const tool of tools) {
      const found = await which(tool)
      if (found) await symlink(found, join(bin, tool))
    }
    const { code, stderr } = await install(['--appimage'], { PATH: bin })
    expect(code).toBe(1)
    expect(stderr).toContain('needs sha512sum or shasum')
    expect(await exists(join(home, 'Applications'))).toBe(false)
  })

  it("says so when the release can't be reached", async () => {
    files.clear()
    const { code, stderr } = await install(['--appimage'])
    expect(code).toBe(1)
    expect(stderr).toContain("The latest release couldn't be found.")
  })

  it('removes the AppImage, its entry and its icon, and leaves the projects', async () => {
    await install(['--appimage'])
    const projects = join(home, '.config/inksprite/Projects')
    await mkdir(projects, { recursive: true })
    const { code, stdout } = await install(['--uninstall'])
    expect(code).toBe(0)
    expect(stdout).toContain('Your projects and settings are left where they are.')
    expect(await exists(join(home, 'Applications', `inksprite-linux-${IMAGE}.AppImage`))).toBe(
      false
    )
    expect(await exists(join(home, '.local/share/applications/inksprite.desktop'))).toBe(false)
    expect(await exists(join(home, '.local/share/icons/hicolor/512x512/apps/inksprite.png'))).toBe(
      false
    )
    expect(await exists(projects)).toBe(true)
  })

  it("refuses an option it doesn't have", async () => {
    const { code, stderr } = await install(['--everything'])
    expect(code).toBe(1)
    expect(stderr).toContain("--everything isn't one of this script's options")
  })
})
