/**
 * @module utils/projectList
 * @description The projects as they are listed for picking one: found by
 * name, and in an order.
 *
 * Pure: the rows come from `useProjects`.
 */

import { compareNames } from './compareNames.js'

/**
 * A project in a list.
 *
 * @typedef {Object} ProjectRow
 * @property {string} id
 * @property {string} name
 * @property {number} [edited] - When something in it last changed
 * @property {number} [created]
 */

/**
 * What a list is sorted by, and which way.
 *
 * @typedef {{by: 'name'|'edited'|'created', descending: boolean}} ProjectOrder
 */

/**
 * By name, numbers as numbers, with two of one name in a fixed order.
 *
 * @param {ProjectRow} a
 * @param {ProjectRow} b
 * @returns {number}
 */
const byName = (a, b) => compareNames(a.name, b.name) || a.id.localeCompare(b.id)

/**
 * In the order asked for. Projects with the same time go by name, whichever
 * way the times run.
 *
 * @param {ProjectRow[]} rows
 * @param {ProjectOrder} order
 * @returns {ProjectRow[]}
 */
export function sortProjects(rows, { by, descending }) {
  const sign = descending ? -1 : 1
  const compare =
    by === 'name'
      ? byName
      : (/** @type {ProjectRow} */ a, /** @type {ProjectRow} */ b) => (a[by] || 0) - (b[by] || 0)
  return [...rows].sort((a, b) => sign * compare(a, b) || byName(a, b))
}

/**
 * The projects edited most recently, the latest first.
 *
 * @param {ProjectRow[]} rows
 * @param {number} limit
 * @returns {ProjectRow[]}
 */
export function recentProjects(rows, limit) {
  return sortProjects(rows, { by: 'edited', descending: true }).slice(0, limit)
}

/**
 * Text as it is compared when looking for a name: without case or accents.
 *
 * @param {string} text
 * @returns {string}
 */
const folded = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/**
 * The projects with every word of the query somewhere in their names.
 *
 * @param {ProjectRow[]} rows
 * @param {string} query
 * @returns {ProjectRow[]}
 */
export function projectsNamed(rows, query) {
  const words = folded(query).split(/\s+/).filter(Boolean)
  return rows.filter(row => {
    const name = folded(row.name)
    return words.every(word => name.includes(word))
  })
}
