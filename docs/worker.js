/* global Headers, Request, Response */
/**
 * The docs site on Cloudflare (`wrangler.jsonc`), which also answers for
 * inksprite.io. Cloudflare serves the built site in `dist` itself; this runs
 * only for `/` and `/install`:
 *
 * - inksprite.io's `/` goes to the app, until the landing page takes its
 *   place. The docs' own `/` is the built site's, which goes to Getting
 *   Started.
 * - `/install`, the install script, is served as plain text, so a browser
 *   shows it to be read rather than downloading it.
 */

/** The address the bare domain sends its visitors to, for now. */
const APP = 'https://app.inksprite.io/';

/**
 * Answer a request that reached the Worker.
 *
 * @param {Request} request
 * @param {{fetch: (request: Request) => Promise<Response>}} assets - The built site
 * @returns {Promise<Response>}
 */
export async function handle(request, assets) {
	const url = new URL(request.url);
	if (url.pathname === '/' && url.hostname === 'inksprite.io') {
		// Temporary, so that browsers ask again once the landing page is there.
		return Response.redirect(APP, 307);
	}
	const response = await assets.fetch(request);
	if (url.pathname !== '/install' || !response.ok) return response;
	const headers = new Headers(response.headers);
	headers.set('content-type', 'text/plain; charset=utf-8');
	headers.set('cache-control', 'no-cache');
	return new Response(response.body, { status: response.status, headers });
}

export default {
	/**
	 * @param {Request} request
	 * @param {{ASSETS: {fetch: (request: Request) => Promise<Response>}}} env
	 */
	fetch: (request, env) => handle(request, env.ASSETS),
};
