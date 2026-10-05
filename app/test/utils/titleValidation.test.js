import { describe, it, expect } from 'vitest'
import {
  normalizeTitle,
  shouldUpdateTitle,
  isCustomTitle,
  getTitlePlaceholder,
} from '@/utils/titleValidation'

describe('titleValidation', () => {
  describe('normalizeTitle', () => {
    it('should trim whitespace from titles', () => {
      expect(normalizeTitle('  Title  ')).toBe('Title')
      expect(normalizeTitle('\tTitle\n')).toBe('Title')
      expect(normalizeTitle('   ')).toBe('')
    })

    it('should handle null and undefined', () => {
      expect(normalizeTitle(null)).toBe('')
      expect(normalizeTitle(undefined)).toBe('')
    })

    it('should preserve internal whitespace', () => {
      expect(normalizeTitle('  Part One  ')).toBe('Part One')
      expect(normalizeTitle('Chapter  Two')).toBe('Chapter  Two')
    })

    it('should handle empty strings', () => {
      expect(normalizeTitle('')).toBe('')
      expect(normalizeTitle('   ')).toBe('')
    })
  })

  describe('shouldUpdateTitle', () => {
    it('should return true when titles differ after normalization', () => {
      expect(shouldUpdateTitle('New Title', 'Old Title')).toBe(true)
      expect(shouldUpdateTitle('  New Title  ', 'Old Title')).toBe(true)
      expect(shouldUpdateTitle('Title', '')).toBe(true)
      expect(shouldUpdateTitle('', 'Title')).toBe(true)
    })

    it('should return false when titles are the same after normalization', () => {
      expect(shouldUpdateTitle('Title', 'Title')).toBe(false)
      expect(shouldUpdateTitle('  Title  ', 'Title')).toBe(false)
      expect(shouldUpdateTitle('', '')).toBe(false)
      expect(shouldUpdateTitle('   ', '')).toBe(false)
    })

    it('should handle null and undefined', () => {
      expect(shouldUpdateTitle(null, null)).toBe(false)
      expect(shouldUpdateTitle(undefined, undefined)).toBe(false)
      expect(shouldUpdateTitle(null, '')).toBe(false)
      expect(shouldUpdateTitle('', null)).toBe(false)
      expect(shouldUpdateTitle('Title', null)).toBe(true)
      expect(shouldUpdateTitle(null, 'Title')).toBe(true)
    })

    it('should ignore whitespace differences', () => {
      expect(shouldUpdateTitle('  Title  ', '  Title  ')).toBe(false)
      expect(shouldUpdateTitle('\tTitle\n', 'Title')).toBe(false)
      expect(shouldUpdateTitle('Title', '  Title  ')).toBe(false)
    })
  })

  describe('isCustomTitle', () => {
    it('should return true for non-empty titles', () => {
      expect(isCustomTitle('Title')).toBe(true)
      expect(isCustomTitle('  Title  ')).toBe(true)
      expect(isCustomTitle('Act 1')).toBe(true)
      expect(isCustomTitle('Chapter 1')).toBe(true)
      expect(isCustomTitle('Prologue')).toBe(true)
    })

    it('should return false for empty titles', () => {
      expect(isCustomTitle('')).toBe(false)
      expect(isCustomTitle('   ')).toBe(false)
      expect(isCustomTitle('\t\n')).toBe(false)
    })

    it('should return false for null and undefined', () => {
      expect(isCustomTitle(null)).toBe(false)
      expect(isCustomTitle(undefined)).toBe(false)
    })

    it('should handle whitespace-only strings', () => {
      expect(isCustomTitle('     ')).toBe(false)
      expect(isCustomTitle('\t')).toBe(false)
      expect(isCustomTitle('\n')).toBe(false)
      expect(isCustomTitle(' \t\n ')).toBe(false)
    })
  })

  describe('getTitlePlaceholder', () => {
    it('should return correct placeholder for parts', () => {
      expect(getTitlePlaceholder('part', 1)).toBe('Leave empty for "Act 1"')
      expect(getTitlePlaceholder('part', 2)).toBe('Leave empty for "Act 2"')
      expect(getTitlePlaceholder('part', 10)).toBe('Leave empty for "Act 10"')
    })

    it('should return correct placeholder for scenes', () => {
      expect(getTitlePlaceholder('scene', 1)).toBe('Leave empty for "Chapter 1"')
      expect(getTitlePlaceholder('scene', 5)).toBe('Leave empty for "Chapter 5"')
      expect(getTitlePlaceholder('scene', 20)).toBe('Leave empty for "Chapter 20"')
    })

    it('should return correct placeholder for drafts', () => {
      expect(getTitlePlaceholder('draft', 1)).toBe('Leave empty for "Draft 1"')
      expect(getTitlePlaceholder('draft', 3)).toBe('Leave empty for "Draft 3"')
      expect(getTitlePlaceholder('draft', 15)).toBe('Leave empty for "Draft 15"')
    })

    it('should return default placeholder for unknown types', () => {
      expect(getTitlePlaceholder('unknown', 1)).toBe('Enter title')
      expect(getTitlePlaceholder('', 1)).toBe('Enter title')
      expect(getTitlePlaceholder(null, 1)).toBe('Enter title')
      expect(getTitlePlaceholder(undefined, 1)).toBe('Enter title')
    })

    it('should handle different position values', () => {
      expect(getTitlePlaceholder('part', 0)).toBe('Leave empty for "Act 0"')
      expect(getTitlePlaceholder('scene', -1)).toBe('Leave empty for "Chapter -1"')
      expect(getTitlePlaceholder('draft', 999)).toBe('Leave empty for "Draft 999"')
    })
  })
})
