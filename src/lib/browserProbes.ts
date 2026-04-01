/**
 * In-browser probes for URL reachability. These run in the user’s browser (subject to
 * CORS, mixed content, extensions, and filter rules). Scripted fetches and iframes can
 * fail even when top-level navigation to the same URL works — callers should treat
 * failures as inconclusive when corroborated by edge checks.
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
 * Hidden iframe navigation. `load` fires when the navigation completes (including many
 * block / error pages). `X-Frame-Options` / CSP `frame-ancestors` can block embedding
 * even when a new tab would load the URL — prefer pairing with edge + manual open link.
 *
 * No `sandbox` attribute: a restrictive sandbox breaks many real sites; URLs are user-supplied
 * test targets only, and the iframe is removed immediately after the probe finishes.
 */
export function probeIframeLoad(url: string): Promise<BrowserProbeResult> {
	return new Promise((resolve) => {
		const start = Date.now();
		let finished = false;

		const finish = (ok: boolean, error: string | null) => {
			if (finished) return;
			finished = true;
			window.clearTimeout(timer);
			try {
				iframe.remove();
			} catch {
				/* ignore */
			}
			resolve({ ok, durationMs: Date.now() - start, error });
		};

		const iframe = document.createElement('iframe');
		iframe.setAttribute('aria-hidden', 'true');
		iframe.setAttribute('referrerpolicy', 'no-referrer');
		iframe.style.cssText =
			'position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;visibility:hidden';

		const timer = window.setTimeout(() => finish(false, 'timeout'), BROWSER_TIMEOUT_MS);

		iframe.addEventListener('load', () => finish(true, null));
		iframe.addEventListener('error', () => finish(false, 'iframe error'));

		iframe.src = url;
		document.body.appendChild(iframe);
	});
}
