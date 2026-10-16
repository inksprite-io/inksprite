/* global createImageBitmap */
/**
 * @module cards/thumbnail
 * @description A small copy of a card's picture, for the library's grid.
 *
 * Card art is often a megabyte or more at full size, and a grid of a few
 * hundred of them decoded at once is a lot of memory for pictures shown an
 * inch wide. So each gets a copy the width of a cell on a dense screen, made
 * once and kept.
 */

/** Wide enough for a grid cell at twice its size. */
export const THUMBNAIL_WIDTH = 320

/**
 * A copy of the picture at most `width` wide, or null where it cannot be
 * made: a picture that does not decode, or nowhere to draw it.
 *
 * Opaque pictures become JPEG, which is small; a picture with transparency in
 * it becomes WebP, or PNG where the browser cannot write WebP, so its edges
 * do not come out black.
 *
 * @param {Blob} image
 * @param {number} [width]
 * @returns {Promise<Blob|null>}
 */
export async function makeThumbnail(image, width = THUMBNAIL_WIDTH) {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null
  try {
    const bitmap = await createImageBitmap(image)
    const scale = Math.min(1, width / bitmap.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return null
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()

    const type = isOpaque(context, canvas.width, canvas.height) ? 'image/jpeg' : 'image/webp'
    return await new Promise(resolve => canvas.toBlob(blob => resolve(blob), type, 0.85))
  } catch {
    return null
  }
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {number} width
 * @param {number} height
 * @returns {boolean}
 */
function isOpaque(context, width, height) {
  const { data } = context.getImageData(0, 0, width, height)
  for (let at = 3; at < data.length; at += 4) if (data[at] < 255) return false
  return true
}
