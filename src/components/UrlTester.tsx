import { useCallback, useMemo, useState } from 'react';
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Legend,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts';
import { probeFetchNoCors, probeIframeLoad, type BrowserProbeResult } from '../lib/browserProbes';
import './UrlTester.css';

type MethodProbe = {
	method: 'HEAD' | 'GET';
	completed: boolean;
	status: number;
	error: string | null;
	durationMs: number;
};

type CheckPayload = {
	url: string;
	accessible: boolean;
	status: number;
	methods: MethodProbe[];
};

export type FilterVerdict = 'allowed' | 'unverified' | 'blocked';

export type MergedCheckResult = {
	edge: CheckPayload;
	verdict: FilterVerdict;
	browserFetch: BrowserProbeResult;
	browserIframe: BrowserProbeResult;
};

export type ResultRow = {
	url: string;
	loading: boolean;
	error?: string;
	result?: MergedCheckResult;
	checkedAt?: string;
};

function normalizeUrlInput(input: string): string {
	let t = input.trim();
	if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
	return t;
}

function parseCsvLine(line: string): string[] {
	const out: string[] = [];
	let cur = '';
	let inQ = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			inQ = !inQ;
		} else if ((ch === ',' || ch === ';' || ch === '\t') && !inQ) {
			out.push(cur.trim());
			cur = '';
		} else {
			cur += ch;
		}
	}
	out.push(cur.trim());
	return out.map((c) => c.replace(/^"|"$/g, ''));
}

function rowLooksLikeUrl(cell: string): boolean {
	const t = cell.trim();
	if (!t) return false;
	if (/^https?:\/\//i.test(t)) return true;
	if (/^www\./i.test(t)) return true;
	return /\.[a-z0-9-]{2,}\//i.test(t) || /\.[a-z0-9-]{2,}$/i.test(t);
}

export function parseUrlsFromCsv(text: string): string[] {
	const lines = text
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	if (!lines.length) return [];

	let headerIdx = -1;
	const firstCells = parseCsvLine(lines[0]!);
	const urlCol = firstCells.findIndex(
		(c) => c.toLowerCase() === 'url' || c.toLowerCase().endsWith('url'),
	);
	if (urlCol >= 0) headerIdx = 0;

	const urls: string[] = [];
	const seen = new Set<string>();

	for (let i = 0; i < lines.length; i++) {
		if (i === headerIdx) continue;
		const cells = parseCsvLine(lines[i]!);
		let candidate = '';
		if (urlCol >= 0 && cells[urlCol]) candidate = cells[urlCol]!;
		else {
			const hit = cells.find((c) => rowLooksLikeUrl(c));
			candidate = hit ?? cells[0] ?? '';
		}
		const u = candidate.trim();
		if (!u || u.toLowerCase() === 'url') continue;
		const key = u.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		urls.push(u);
	}
	return urls;
}

function computeVerdict(
	clientOk: boolean,
	edgeAllowed: boolean,
): FilterVerdict {
	if (clientOk) return 'allowed';
	if (edgeAllowed) return 'unverified';
	return 'blocked';
}

async function checkMerged(url: string): Promise<MergedCheckResult> {
	const target = normalizeUrlInput(url);

	const [edgeRes, browserFetch, browserIframe] = await Promise.all([
		fetch('/api/check-url', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ url: target }),
		}).then(async (res) => {
			if (!res.ok) {
				const j = await res.json().catch(() => ({}));
				const msg =
					j && typeof j === 'object' && 'error' in j && typeof (j as { error: string }).error === 'string'
						? (j as { error: string }).error
						: `HTTP ${res.status}`;
				throw new Error(msg);
			}
			return (await res.json()) as CheckPayload;
		}),
		probeFetchNoCors(target),
		probeIframeLoad(target),
	]);

	const clientOk = browserFetch.ok || browserIframe.ok;
	const edgeAllowed = edgeRes.accessible;
	const verdict = computeVerdict(clientOk, edgeAllowed);

	return {
		edge: edgeRes,
		verdict,
		browserFetch,
		browserIframe,
	};
}

async function mapPool<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let i = 0;
	async function worker() {
		while (i < items.length) {
			const idx = i++;
			results[idx] = await fn(items[idx]!);
		}
	}
	const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
	await Promise.all(workers);
	return results;
}

function formatEdgeMethods(m: MethodProbe[]): string {
	return m
		.map(
			(p) =>
				`${p.method}: ${p.completed ? p.status || '—' : 'fail'}${p.error ? ` (${p.error.slice(0, 80)})` : ''} ${p.durationMs}ms`,
		)
		.join(' · ');
}

function formatProbeLine(label: string, p: BrowserProbeResult): string {
	const status = p.ok ? 'ok' : 'fail';
	const err = p.error ? ` (${p.error.slice(0, 60)})` : '';
	return `${label}: ${status}${err} ${p.durationMs}ms`;
}

function statusBucket(status: number): string {
	if (!status) return 'No response';
	if (status >= 200 && status < 300) return '2xx';
	if (status >= 300 && status < 400) return '3xx';
	if (status >= 400 && status < 500) return '4xx';
	if (status >= 500) return '5xx';
	return 'Other';
}

const PIE_ALLOWED = '#ef4444';
const PIE_UNVERIFIED = '#f59e0b';
const PIE_BLOCKED = '#22c55e';

export default function UrlTester() {
	const [rawInput, setRawInput] = useState('');
	const [rows, setRows] = useState<ResultRow[]>([]);
	const [running, setRunning] = useState(false);
	const [progress, setProgress] = useState({ done: 0, total: 0 });

	const loadFile = useCallback((f: File) => {
		const reader = new FileReader();
		reader.onload = () => {
			const t = typeof reader.result === 'string' ? reader.result : '';
			setRawInput(t);
		};
		reader.readAsText(f);
	}, []);

	const startFromUrls = useCallback(async (urls: string[]) => {
		if (!urls.length) return;
		const initial: ResultRow[] = urls.map((url) => ({ url, loading: true }));
		setRows(initial);
		setRunning(true);
		setProgress({ done: 0, total: urls.length });

		let completed = 0;
		await mapPool(urls, 4, async (url) => {
			try {
				const result = await checkMerged(url);
				const checkedAt = new Date().toISOString();
				setRows((prev) => {
					const next = [...prev];
					const i = next.findIndex((r) => r.url === url);
					if (i >= 0) next[i] = { url, loading: false, result, checkedAt };
					return next;
				});
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				setRows((prev) => {
					const next = [...prev];
					const i = next.findIndex((r) => r.url === url);
					if (i >= 0)
						next[i] = {
							url,
							loading: false,
							error: msg,
							checkedAt: new Date().toISOString(),
						};
					return next;
				});
			}
			completed += 1;
			setProgress({ done: completed, total: urls.length });
		});

		setRunning(false);
	}, []);

	const runTests = useCallback(() => {
		const urls = parseUrlsFromCsv(rawInput);
		void startFromUrls(urls);
	}, [rawInput, startFromUrls]);

	const summary = useMemo(() => {
		const finished = rows.filter((r) => !r.loading);
		const withErr = finished.filter((r) => r.error).length;
		const allowed = finished.filter((r) => r.result?.verdict === 'allowed').length;
		const unverified = finished.filter((r) => r.result?.verdict === 'unverified').length;
		const blocked = finished.filter((r) => r.result?.verdict === 'blocked').length;

		const bucketMap = new Map<string, number>();
		for (const r of finished) {
			if (!r.result?.edge) continue;
			const st = r.result.edge.status ?? 0;
			const b = statusBucket(st);
			bucketMap.set(b, (bucketMap.get(b) ?? 0) + 1);
		}
		const barData = [...bucketMap.entries()].map(([name, count]) => ({ name, count }));

		return {
			finished: finished.length,
			allowed,
			unverified,
			blocked,
			withErr,
			barData,
		};
	}, [rows]);

	const verdictPieData = useMemo(() => {
		if (!summary.finished) return [];
		return [
			{ name: 'Allowed (automated)', value: summary.allowed, fill: PIE_ALLOWED },
			{ name: 'Unverified', value: summary.unverified, fill: PIE_UNVERIFIED },
			{ name: 'Blocked (automated)', value: summary.blocked, fill: PIE_BLOCKED },
		].filter((d) => d.value > 0);
	}, [summary]);

	const exportCsv = useCallback(() => {
		const cell = (s: string) => {
			if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
			return s;
		};
		const header = [
			'url',
			'filter_verdict',
			'fetch_ok',
			'fetch_ms',
			'fetch_error',
			'iframe_ok',
			'iframe_ms',
			'iframe_error',
			'edge_http_response',
			'edge_best_status',
			'head_status',
			'head_ok',
			'get_status',
			'get_ok',
			'edge_methods_detail',
			'api_error',
			'checked_at',
		];
		const lines = [header.join(',')];
		for (const r of rows) {
			if (r.loading) continue;
			if (r.error) {
				lines.push(
					[
						cell(r.url),
						'error',
						'',
						'',
						'',
						'',
						'',
						'',
						'',
						'',
						'',
						'',
						'',
						'',
						'',
						cell(r.error),
						cell(r.checkedAt ?? ''),
					].join(','),
				);
				continue;
			}
			const res = r.result;
			if (!res) continue;
			const e = res.edge;
			const headM = e.methods.find((m) => m.method === 'HEAD');
			const getM = e.methods.find((m) => m.method === 'GET');
			lines.push(
				[
					cell(r.url),
					res.verdict,
					res.browserFetch.ok ? 'yes' : 'no',
					String(res.browserFetch.durationMs),
					cell(res.browserFetch.error ?? ''),
					res.browserIframe.ok ? 'yes' : 'no',
					String(res.browserIframe.durationMs),
					cell(res.browserIframe.error ?? ''),
					e.accessible ? 'yes' : 'no',
					e.status ?? '',
					headM?.status ?? '',
					headM?.completed ? 'yes' : 'no',
					getM?.status ?? '',
					getM?.completed ? 'yes' : 'no',
					cell(formatEdgeMethods(e.methods)),
					'',
					cell(r.checkedAt ?? ''),
				].join(','),
			);
		}
		const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `url-check-results-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
		a.click();
		URL.revokeObjectURL(a.href);
	}, [rows]);

	function renderBadge(r: ResultRow) {
		if (r.loading) return <span className="badge pending">Checking</span>;
		if (r.error) return <span className="badge error">Error</span>;
		const v = r.result?.verdict;
		if (v === 'allowed') return <span className="badge allowed">Allowed</span>;
		if (v === 'unverified') return <span className="badge unverified">Unverified</span>;
		if (v === 'blocked') return <span className="badge blocked">Blocked</span>;
		return null;
	}

	return (
		<div className="url-tester">
			<h1>Test your URL list</h1>
			<p className="lede">
				Paste or upload a CSV of URLs. Each row runs <strong>three checks in parallel</strong>: in-browser{' '}
				<code>fetch</code> (no-cors), a hidden <code>iframe</code> load, and edge HTTP probes (HEAD + partial GET)
				from Cloudflare. <span className="lede-em">Red (Allowed)</span> means at least one scripted probe succeeded
				— a likely filter flaw for blocklists. <span className="lede-em lede-green">Green (Blocked)</span> means
				both scripted probes failed and the edge saw no HTTP response. <span className="lede-em lede-amber">
					Amber (Unverified)
				</span>{' '}
				means scripted checks failed but the edge got HTTP — filters often block JavaScript while still allowing a
				tab to open. <strong>Open the link in a new tab</strong> to confirm; if the page loads, treat it as allowed
				(filter flaw).
			</p>

			<div className="panel">
				<label htmlFor="csv-area">URLs (CSV or one URL per line)</label>
				<textarea
					id="csv-area"
					value={rawInput}
					onChange={(e) => setRawInput(e.target.value)}
					placeholder={`https://example.com\nhttps://www.example.org/path\nOr CSV with a header row containing "url"`}
					spellCheck={false}
				/>
				<div className="row-actions">
					<button type="button" className="btn-primary" disabled={running} onClick={() => void runTests()}>
						{running ? 'Running…' : 'Run checks'}
					</button>
					<label>
						<input
							type="file"
							accept=".csv,text/csv,text/plain"
							disabled={running}
							onChange={(e) => {
								const f = e.target.files?.[0];
								if (f) loadFile(f);
								e.target.value = '';
							}}
						/>
					</label>
					<button
						type="button"
						className="btn-secondary"
						disabled={running || !rows.some((r) => !r.loading)}
						onClick={exportCsv}
					>
						Export results CSV
					</button>
				</div>
				{running && (
					<p className="progress">
						Progress: {progress.done} / {progress.total}
					</p>
				)}
			</div>

			{rows.length > 0 && (
				<div className="panel">
					<label>Results</label>
					<div className="table-wrap">
						<table>
							<thead>
								<tr>
									<th>Verdict</th>
									<th>URL (open to verify)</th>
									<th>Probes</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((r) => (
									<tr key={r.url}>
										<td>{renderBadge(r)}</td>
										<td className="link-cell">
											<a href={normalizeUrlInput(r.url)} target="_blank" rel="noopener noreferrer">
												{r.url}
											</a>
										</td>
										<td className="methods">
											{r.loading && '—'}
											{r.error && <span title={r.error}>{r.error}</span>}
											{r.result && (
												<>
													<div>{formatProbeLine('Fetch', r.result.browserFetch)}</div>
													<div>{formatProbeLine('Iframe', r.result.browserIframe)}</div>
													<div>Edge: {formatEdgeMethods(r.result.edge.methods)}</div>
												</>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{summary.finished > 0 && (
				<div className="panel">
					<label>Summary</label>
					<div className="stat-cards">
						<div className="stat-card">
							<div className="num">{summary.finished}</div>
							<div className="lbl">Checked</div>
						</div>
						<div className="stat-card">
							<div className="num stat-allowed">{summary.allowed}</div>
							<div className="lbl">Allowed (red)</div>
						</div>
						<div className="stat-card">
							<div className="num stat-unverified">{summary.unverified}</div>
							<div className="lbl">Unverified (amber)</div>
						</div>
						<div className="stat-card">
							<div className="num stat-blocked">{summary.blocked}</div>
							<div className="lbl">Blocked (green)</div>
						</div>
						{summary.withErr > 0 && (
							<div className="stat-card">
								<div className="num stat-error">{summary.withErr}</div>
								<div className="lbl">API / validation errors</div>
							</div>
						)}
					</div>
					<div className="summary-grid">
						<div className="chart-box">
							<h3>Verdict mix</h3>
							{verdictPieData.length > 0 ? (
								<ResponsiveContainer width="100%" height={220}>
									<PieChart>
										<Pie
											data={verdictPieData}
											dataKey="value"
											nameKey="name"
											cx="50%"
											cy="50%"
											outerRadius={78}
											label
										>
											{verdictPieData.map((entry) => (
												<Cell key={entry.name} fill={entry.fill} />
											))}
										</Pie>
										<Tooltip
											contentStyle={{
												background: '#1e293b',
												border: '1px solid #334155',
												borderRadius: 8,
											}}
										/>
										<Legend />
									</PieChart>
								</ResponsiveContainer>
							) : (
								<p className="note" style={{ margin: 0 }}>
									No data yet.
								</p>
							)}
						</div>
						<div className="chart-box">
							<h3>Edge HTTP status groups</h3>
							{summary.barData.length > 0 ? (
								<ResponsiveContainer width="100%" height={220}>
									<BarChart data={summary.barData}>
										<CartesianGrid strokeDasharray="3 3" stroke="#334155" />
										<XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} />
										<YAxis allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
										<Tooltip
											contentStyle={{
												background: '#1e293b',
												border: '1px solid #334155',
												borderRadius: 8,
											}}
										/>
										<Bar dataKey="count" fill="#38bdf8" radius={[6, 6, 0, 0]} />
									</BarChart>
								</ResponsiveContainer>
							) : (
								<p className="note" style={{ margin: 0 }}>
									No edge status buckets yet.
								</p>
							)}
						</div>
					</div>
					<p className="note">
						Automated probes cannot read cross-origin tab navigations. If a row is <strong>Unverified</strong> but
						the site opens in a new tab, count that as <strong>Allowed</strong> for filter testing. Block pages
						that return HTTP 200 may still register as Allowed to scripted checks.
					</p>
				</div>
			)}
		</div>
	);
}
