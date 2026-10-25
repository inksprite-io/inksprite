/**
 * The sandbox page: it starts Python in a worker and hands it the port from
 * the preload. The code runs there, where the page's window is out of reach.
 */

window.addEventListener('message', function onPort(event) {
  if (event.source !== window || event.data !== 'port') return
  window.removeEventListener('message', onPort)
  const worker = new Worker('worker.js', { type: 'module' })
  worker.postMessage('port', [event.ports[0]])
})
