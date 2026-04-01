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

export type ResultRow = {
	url: string;
	loading: boolean;
	error?: string;
	result?: CheckPayload;
	checkedAt?: string;
};

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

async function checkOne(url: string): Promise<CheckPayload> {
	const res = await fetch('/api/check-url', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ url }),
	});
	if (!res.ok) {
		const j = await res.json().catch(() => ({}));
		const msg =
			j && typeof j === 'object' && 'error' in j && typeof (j as { error: string }).error === 'string'
				? (j as { error: string }).error
				: `HTTP ${res.status}`;
		throw new Error(msg);
	}
	return (await res.json()) as CheckPayload;
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

function formatMethods(m: MethodProbe[]): string {
	return m
		.map(
			(p) =>
				`${p.method}: ${p.completed ? p.status || '—' : 'fail'}${p.error ? ` (${p.error.slice(0, 80)})` : ''} ${p.durationMs}ms`,
		)
		.join(' · ');
}

function statusBucket(status: number): string {
	if (!status) return 'No response';
	if (status >= 200 && status < 300) return '2xx';
	if (status >= 300 && status < 400) return '3xx';
	if (status >= 400 && status < 500) return '4xx';
	if (status >= 500) return '5xx';
	return 'Other';
}

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
			const idx = urls.indexOf(url);
			try {
				const result = await checkOne(url);
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
		const ok = finished.filter((r) => r.result?.accessible).length;
		const bad = finished.length - ok;
		const withErr = finished.filter((r) => r.error).length;

		const bucketMap = new Map<string, number>();
		for (const r of finished) {
			const st = r.result?.status ?? 0;
			const b = statusBucket(st);
			bucketMap.set(b, (bucketMap.get(b) ?? 0) + 1);
		}
		const barData = [...bucketMap.entries()].map(([name, count]) => ({ name, count }));

		return { finished: finished.length, ok, bad, withErr, barData };
	}, [rows]);

	const pieData = useMemo(() => {
		if (!summary.finished) return [];
		return [
			{ name: 'HTTP response', value: summary.ok, fill: '#22c55e' },
			{ name: 'No HTTP response', value: summary.bad, fill: '#ef4444' },
		].filter((d) => d.value > 0);
	}, [summary]);

	const exportCsv = useCallback(() => {
		const cell = (s: string) => {
			if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
			return s;
		};
		const header = [
			'url',
			'accessible',
			'best_status',
			'head_status',
			'head_ok',
			'get_status',
			'get_ok',
			'methods_detail',
			'error',
			'checked_at',
		];
		const lines = [header.join(',')];
		for (const r of rows) {
			if (r.loading) continue;
			const res = r.result;
			const headM = res?.methods.find((m) => m.method === 'HEAD');
			const getM = res?.methods.find((m) => m.method === 'GET');
			lines.push(
				[
					cell(r.url),
					res?.accessible ? 'yes' : 'no',
					res?.status ?? '',
					headM?.status ?? '',
					headM?.completed ? 'yes' : 'no',
					getM?.status ?? '',
					getM?.completed ? 'yes' : 'no',
					cell(res ? formatMethods(res.methods) : ''),
					cell(r.error ?? ''),
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

	return (
		<div className="url-tester">
			<h1>Test your URL list</h1>
			<p className="lede">
				Paste or upload a CSV of URLs. Each address is checked from the cloud using two independent HTTP probes
				(HEAD and a partial GET). Green means the edge received an HTTP status (the host answered). Red means no
				response was received. Open any link in a new tab to confirm behaviour on <em>your</em> network or filter.
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
									<th>Status</th>
									<th>URL</th>
									<th>Probes</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((r) => (
									<tr key={r.url}>
										<td>
											{r.loading && <span className="badge pending">Checking</span>}
											{!r.loading && r.error && <span className="badge bad">No response</span>}
											{!r.loading && r.result?.accessible && (
												<span className="badge ok">HTTP {r.result.status || 'OK'}</span>
											)}
											{!r.loading && r.result && !r.result.accessible && !r.error && (
												<span className="badge bad">No response</span>
											)}
										</td>
										<td className="link-cell">
											<a href={r.url} target="_blank" rel="noopener noreferrer">
												{r.url}
											</a>
										</td>
										<td className="methods">
											{r.loading && '—'}
											{r.error && <span title={r.error}>{r.error}</span>}
											{r.result && formatMethods(r.result.methods)}
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
							<div className="num" style={{ color: 'var(--tf-green)' }}>
								{summary.ok}
							</div>
							<div className="lbl">Got HTTP status</div>
						</div>
						<div className="stat-card">
							<div className="num" style={{ color: 'var(--tf-red)' }}>
								{summary.bad}
							</div>
							<div className="lbl">No HTTP response</div>
						</div>
						{summary.withErr > 0 && (
							<div className="stat-card">
								<div className="num">{summary.withErr}</div>
								<div className="lbl">API / validation errors</div>
							</div>
						)}
					</div>
					<div className="summary-grid">
						<div className="chart-box">
							<h3>Responses vs no response</h3>
							{pieData.length > 0 ? (
								<ResponsiveContainer width="100%" height={220}>
									<PieChart>
										<Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={78} label>
											{pieData.map((entry) => (
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
							<h3>Status code groups</h3>
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
									No status buckets yet.
								</p>
							)}
						</div>
					</div>
					<p className="note">
						Checks run from Cloudflare’s network, not from your browser. A green result means the URL returned an
						HTTP status to our probes; your local filter may still block the same URL when you browse. Use “open
						in new tab” to verify from your side.
					</p>
				</div>
			)}
		</div>
	);
}
