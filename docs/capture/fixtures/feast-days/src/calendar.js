import { movableFeasts } from './feasts.js'

const year = Number(process.argv[2]) || 1500

for (const { name, date } of movableFeasts(year)) {
  console.log(`${date.toISOString().slice(5, 10)}  ${name}`)
}
