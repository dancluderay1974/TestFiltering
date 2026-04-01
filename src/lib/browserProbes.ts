/**
 * In-browser probes for URL reachability. These run in the user’s browser (subject to
 * CORS, mixed content, extensions, and filter rules).
 *
 * Important: iframe `load` fires for built-in browser error pages (e.g. connection
 * failed / proxy block), so iframe must NOT be used as a success signal for “reachable”.
 * Prefer fetch + image-based probes (favicon / apple-touch) which get real load/error
 * semantics for subresources.
 */

const BROWSER_TIMEOUT_MS = 14_000;

export type BrowserProbeResult = {
	ok: boolean;
	durationMs: number;
	error: string | null;
};

/**
 * `fetch` with `no-cors` — opaque response; success means the browser received some response.
 */
export async function probeFetchNoCors(url: string): Promise<BrowserProbeResult> {
	const start = Date.now();
	const controller = new AbortController();
	const timer = window.setTimeout(() => controller.abort(), BROWSER_TIMEOUT_MS);
	try {
		await fetch(url, {
			method: 'GET',
			mode: 'no-cors',
			cache: 'no-store',
			signal: controller.signal,
		});
		window.clearTimeout(timer);
		return { ok: true, durationMs: Date.now() - start, error: null };
	} catch (e) {
		window.clearTimeout(timer);
		const msg = e instanceof Error ? e.message : String(e);
		return { ok: false, durationMs: Date.now() - start, error: msg };
	}
}

/**
 * Load a URL as an image (decodes pixels). Fails on network error; works for favicon/apple-touch PNG.
 */
export function probeImageLoad(imageUrl: string): Promise<BrowserProbeResult> {
	return new Promise((resolve) => {
		const start = Date.now();
		let done = false;
		const img = new Image();
		const timer = window.setTimeout(() => finish(false, 'timeout'), BROWSER_TIMEOUT_MS);
		const finish = (ok: boolean, error: string | null) => {
			if (done) return;
			done = true;
			window.clearTimeout(timer);
			try {
				img.remove();
			} catch {
				/* ignore */
			}
			resolve({ ok, durationMs: Date.now() - start, error });
		};
		img.onload = () => finish(true, null);
		img.onerror = () => finish(false, 'image error');
		img.referrerPolicy = 'no-referrer';
		img.src = imageUrl;
	});
}

/** Common favicon path for the page origin. */
export function faviconProbeUrl(pageUrl: string): string {
	const u = new URL(pageUrl);
	u.pathname = '/favicon.ico';
	u.search = '';
	u.hash = '';
	return u.href;
}

/** Secondary icon probe (many sites expose this as PNG). */
export function appleTouchProbeUrl(pageUrl: string): string {
	const u = new URL(pageUrl);
	u.pathname = '/apple-touch-icon.png';
	u.search = '';
	u.hash = '';
	return u.href;
}
