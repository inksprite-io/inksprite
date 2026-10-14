import { easter } from './easter.js'

/** The feasts that move with Easter, by days from it. */
export const MOVABLE = {
  'Ash Wednesday': -46,
  'Palm Sunday': -7,
  'Good Friday': -2,
  'Easter Sunday': 0,
  Ascension: 39,
  Pentecost: 49,
  'Corpus Christi': 60,
}

/** Every movable feast in `year`, in order. */
export function movableFeasts(year) {
  const { month, day } = easter(year)
  return Object.entries(MOVABLE).map(([name, offset]) => ({
    name,
    date: new Date(Date.UTC(year, month - 1, day + offset)),
  }))
}
