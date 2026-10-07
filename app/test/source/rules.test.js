/* global TextEncoder */
import { describe, it, expect } from 'vitest'
import { createRules } from '@/source/rules.js'
import { languageOf, isBinaryName } from '@/source/language.js'
import { lineCount, textOf } from '@/source/text.js'

const bytes = text => new TextEncoder().encode(text)

describe('createRules', () => {
  it('never lets in version control, installed packages or secrets', () => {
    const rules = createRules()
    for (const path of [
      '.git/HEAD',
      'node_modules/left-pad/index.js',
      'packages/app/node_modules/x/y.js',
      '.env',
      'config/.env.production',
      'deploy/server.pem',
      'keys/id_ed25519.pub',
      '.aws/credentials',
      '.npmrc',
    ]) {
      expect(rules.check(path), path).toBe('never')
    }
  })

  it('leaves out build output, lock files and minified code by default', () => {
    const rules = createRules()
    for (const path of [
      'dist/index.js',
      'packages/core/build/out.js',
      'package-lock.json',
      'Cargo.lock',
      'public/vendor.min.js',
      'src/app.js.map',
    ]) {
      expect(rules.check(path), path).toBe('ignored')
    }
  })

  it('lets in source, and the dotfiles that say how a codebase works', () => {
    const rules = createRules()
    for (const path of [
      'src/index.ts',
      'src/build.js',
      '.github/workflows/ci.yml',
      '.gitignore',
      '.eslintrc.json',
      'README.md',
    ]) {
      expect(rules.check(path), path).toBeNull()
    }
  })

  it('follows a .gitignore at the top and in a folder, relative to where it is', () => {
    const rules = createRules()
    rules.addGitignore('', 'generated/\n*.log\n')
    rules.addGitignore('server', 'fixtures/\n')

    expect(rules.check('generated/schema.ts')).toBe('ignored')
    expect(rules.check('server/debug.log')).toBe('ignored')
    expect(rules.check('server/fixtures/a.json')).toBe('ignored')
    // The nested file speaks only for what is below it.
    expect(rules.check('client/fixtures/a.json')).toBeNull()
  })

  it('lets a nearer .gitignore take back what one above it left out', () => {
    const rules = createRules()
    rules.addGitignore('', '*.sql\n')
    rules.addGitignore('db', '!schema.sql\n')

    expect(rules.check('db/seed.sql')).toBe('ignored')
    expect(rules.check('db/schema.sql')).toBeNull()
  })

  it('lets a .gitignore bring back a default, but never a secret', () => {
    const rules = createRules()
    rules.addGitignore('', '!dist/\n!.env\n')

    expect(rules.check('dist/index.js')).toBeNull()
    expect(rules.check('.env')).toBe('never')
  })
})

describe('languageOf', () => {
  it('knows a language by its extension, and some files by their whole name', () => {
    expect(languageOf('index.ts')).toEqual({ language: 'TypeScript', mime: 'text/x-typescript' })
    expect(languageOf('App.vue').language).toBe('Vue')
    expect(languageOf('main.go').mime).toBe('text/x-go')
    expect(languageOf('Makefile').language).toBe('Makefile')
    expect(languageOf('Dockerfile').mime).toBe('text/x-dockerfile')
    expect(languageOf('package.json').mime).toBe('application/json')
  })

  it('calls anything else plain text', () => {
    expect(languageOf('LICENSE')).toEqual({ language: 'Text', mime: 'text/plain' })
    expect(languageOf('notes.weird')).toEqual({ language: 'Text', mime: 'text/plain' })
  })

  it('tells a binary file by its name', () => {
    expect(isBinaryName('logo.png')).toBe(true)
    expect(isBinaryName('font.woff2')).toBe(true)
    expect(isBinaryName('index.ts')).toBe(false)
    expect(isBinaryName('Makefile')).toBe(false)
  })
})

describe('textOf', () => {
  it('reads UTF-8, dropping a byte-order mark and making line ends \\n', () => {
    expect(textOf(bytes('﻿a\r\nb\rc\n'))).toBe('a\nb\nc\n')
    expect(textOf(bytes('naïve — ok'))).toBe('naïve — ok')
  })

  it('is null for bytes with a NUL near the top, or that are not UTF-8', () => {
    expect(textOf(new Uint8Array([0x50, 0x4b, 0x00, 0x03]))).toBeNull()
    expect(textOf(new Uint8Array([0xff, 0xfe, 0xfd]))).toBeNull()
  })
})

describe('lineCount', () => {
  it('counts a last line with or without a newline after it', () => {
    expect(lineCount('')).toBe(0)
    expect(lineCount('one')).toBe(1)
    expect(lineCount('one\n')).toBe(1)
    expect(lineCount('one\ntwo')).toBe(2)
    expect(lineCount('one\n\nthree\n')).toBe(3)
  })
})
