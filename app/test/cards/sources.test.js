import { describe, it, expect } from 'vitest'
import { cardLink } from '@/cards/sources.js'

describe('cards/sources', () => {
  describe('cardLink', () => {
    it('downloads a botbooru card from its page or its download link', () => {
      const png = {
        url: 'https://botbooru.com/download/png/12345',
        name: 'botbooru-12345',
        site: 'botbooru.com',
      }
      expect(cardLink('https://botbooru.com/character/12345')).toEqual(png)
      expect(cardLink('https://botbooru.com/download/png/12345')).toEqual(png)
      expect(cardLink('https://botbooru.com/download/json/12345')).toEqual(png)
      expect(cardLink('botbooru.com/character/12345')).toEqual(png)
    })

    it("downloads a Chub card's PNG from its page, or from creator/name alone", () => {
      const png = {
        url: 'https://avatars.charhub.io/avatars/someone/a-card-1234/chara_card_v2.png',
        name: 'a-card-1234',
        site: 'chub.ai',
      }
      expect(cardLink('https://chub.ai/characters/someone/a-card-1234')).toEqual(png)
      expect(cardLink('https://www.chub.ai/characters/someone/a-card-1234?tab=x')).toEqual(png)
      expect(cardLink('https://venus.chub.ai/characters/someone/a-card-1234')).toEqual(png)
      expect(cardLink('https://characterhub.org/characters/someone/a-card-1234')).toEqual(png)
      expect(cardLink('someone/a-card-1234')).toEqual(png)
    })

    it('takes any other link as the card itself', () => {
      expect(cardLink('https://files.example.com/cards/Maren.png')).toEqual({
        url: 'https://files.example.com/cards/Maren.png',
        name: 'Maren',
        site: 'files.example.com',
      })
      expect(cardLink(' https://files.example.com/a%20card.json ')).toEqual({
        url: 'https://files.example.com/a%20card.json',
        name: 'a card',
        site: 'files.example.com',
      })
    })

    it('is nothing for what is not a link', () => {
      expect(cardLink('')).toBeNull()
      expect(cardLink('just some words')).toBeNull()
      expect(cardLink('ftp://files.example.com/card.png')).toBeNull()
      expect(cardLink('javascript:alert(1)')).toBeNull()
    })
  })
})
