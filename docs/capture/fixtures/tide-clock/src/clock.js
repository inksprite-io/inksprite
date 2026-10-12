import { nextHighTide } from './tides.js'

const STATION = process.env.TIDE_STATION || 'north-point'

function show() {
  const next = nextHighTide(new Date(), STATION)
  const time = next.toISOString().slice(11, 16)
  console.log(`Next high tide at ${STATION}: ${time} UTC`)
}

show()
setInterval(show, 60_000)
