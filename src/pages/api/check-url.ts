import type { APIRoute } from 'astro';

export const prerender = false;

const TIMEOUT_MS = 20_000;
const UA = 'TestFiltering-URLCheck/1.0';

export type MethodProbe = {
	method: 'HEAD' | 'GET';
	completed: boolean;
	status: number;
	error: string | null;
	durationMs: number;
};

function sanitizeTarget(input: string): URL | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	let href = trimmed;
	if (!/^https?:\/\//i.test(href)) href = `https://${href}`;
	try {
		const u = new URL(href);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
		const h = u.hostname.toLowerCase();
		if (h === 'localhost' || h.endsWith('.local')) return null;
		if (h === '0.0.0.0' || h === '[::1]' || h === '::1') return null;
		if (/^(127\.)/.test(h)) return null;
		if (/^10\./.test(h)) return null;
		if (/^192\.168\./.test(h)) return null;
		const m = /^172\.(\d+)\./.exec(h);
		if (m) {
			const n = Number(m[1]);
			if (n >= 16 && n <= 31) return null;
		}
		return u;
	} catch {
		return null;
	}
}

async function probe(
	url: string,
	init: RequestInit & { method: 'HEAD' | 'GET' },
): Promise<MethodProbe> {
	const start = Date.now();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			...init,
			signal: controller.signal,
			redirect: 'follow',
		});
		if (init.method === 'GET' && res.body) {
			const reader = res.body.getReader();
			try {
				await reader.read();
			} finally {
				try {
					await reader.cancel();
				} catch {
					/* ignore */
				}
			}
		}
		return {
			method: init.method,
			completed: true,
			status: res.status,
			error: null,
			durationMs: Date.now() - start,
		};
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return {
			method: init.method,
			completed: false,
			status: 0,
			error: msg,
			durationMs: Date.now() - start,
		};
	} finally {
		clearTimeout(timer);
	}
}

export const POST: APIRoute = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return new Response(JSON.stringify({ error: 'Expected JSON body' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const raw =
		body &&
		typeof body === 'object' &&
		'url' in body &&
		typeof (body as { url: unknown }).url === 'string'
			? (body as { url: string }).url
			: '';

	const parsed = sanitizeTarget(raw);
	if (!parsed) {
		return new Response(JSON.stringify({ error: 'Invalid or disallowed URL' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const url = parsed.toString();

	const head = await probe(url, {
		method: 'HEAD',
		headers: {
			'User-Agent': UA,
			Accept: '*/*',
		},
	});

	const getProbe = await probe(url, {
		method: 'GET',
		headers: {
			'User-Agent': UA,
			Accept: '*/*',
			Range: 'bytes=0-2047',
		},
	});

	const methods: MethodProbe[] = [head, getProbe];

	const gotHttp = methods.some((m) => m.completed && m.status > 0);
	const bestStatus = methods.reduce(
		(acc, m) => (m.completed && m.status > 0 ? m.status : acc),
		0,
	);

	return new Response(
		JSON.stringify({
			url,
			accessible: gotHttp,
			status: bestStatus,
			methods,
		}),
		{
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		},
	);
};
