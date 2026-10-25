/**
 * The sandbox page's preload: it hands the page the one port it talks to the
 * main process through (`../src/sandbox.js`), and gives it nothing else.
 */

const { ipcRenderer } = require('electron')

ipcRenderer.once('port', event => window.postMessage('port', '*', event.ports))
