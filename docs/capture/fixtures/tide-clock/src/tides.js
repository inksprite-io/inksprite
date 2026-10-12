import { station } from './stations.js'

/** A tide comes in twice a lunar day, about every 12 hours and 25 minutes. */
export const TIDE_HOURS = 12.42

/** Hours since midnight on 1 January, in UTC. */
function hoursIntoYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1)
  return (date.getTime() - start) / 3_600_000
}

/** The next high tide at a station after `date`. */
export function nextHighTide(date, stationId) {
  const { firstHigh } = station(stationId)
  const since = hoursIntoYear(date) - firstHigh
  const tides = Math.ceil(since / TIDE_HOURS)
  const hours = firstHigh + tides * TIDE_HOURS
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1) + hours * 3_600_000)
}
