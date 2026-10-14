/**
 * Easter by the Julian calendar, which the city still keeps:
 * the first Sunday after the paschal full moon.
 */

/** The paschal full moon, as days after 21 March. */
function paschalMoon(year) {
  return (19 * (year % 19) + 15) % 30
}

/** Easter Sunday in `year`, as a month (3 or 4) and a day. */
export function easter(year) {
  const moon = paschalMoon(year)
  const toSunday = (2 * (year % 4) + 4 * (year % 7) - moon + 34) % 7
  const days = moon + toSunday + 114
  return { month: Math.floor(days / 31), day: (days % 31) + 1 }
}
