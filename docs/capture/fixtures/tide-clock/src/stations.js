/** Where the tides are read, with the hour of the first high tide on 1 January. */
export const STATIONS = {
  'north-point': { name: 'North Point', firstHigh: 4.2 },
  'gull-rock': { name: 'Gull Rock', firstHigh: 5.1 },
}

export function station(id) {
  const found = STATIONS[id]
  if (!found) throw new Error(`No station called ${id}`)
  return found
}
