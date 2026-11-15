import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { bearerToken, secretMatches } from '../src/utils/secret-utils.js';

// The real settings service needs a database and KV; the init pipeline only has to call it once at the end.
vi.mock('../src/service/setting-service', () => ({ default: { refresh: vi.fn(async () => {}) } }));

const { default: app } = await import('../src/hono/hono.js');
await import('../src/api/init-api.js');

const SECRET = 'unit-test-secret-0123456789-abcdefghijklmnop'; // fake value, not used anywhere real

// A D1 stand-in: any query succeeds. `touched` records whether the database was used at all.
function fakeDb() {
	const touched = { count: 0 };
	const stmt = () => {
		const s = {
			bind: () => s,
			run: async () => { touched.count++; return { results: [], success: true }; },
			all: async () => { touched.count++; return { results: [], success: true }; },
			first: async () => { touched.count++; return new Proxy({}, { get: () => 0 }); },
			raw: async () => { touched.count++; return []; }
		};
		return s;
	};
	return { touched, db: { prepare: () => stmt(), batch: async () => { touched.count++; return []; }, exec: async () => { touched.count++; } } };
}

const call = (method, path, { headers = {}, env = {} } = {}) => {
	const { db, touched } = fakeDb();
	return app.request(path, { method, headers }, { jwt_secret: SECRET, db, kv: {}, ...env }).then((res) => ({ res, touched }));
};

let logs;
beforeEach(() => {
	logs = [];
	for (const m of ['log', 'info', 'warn', 'error', 'debug']) vi.spyOn(console, m).mockImplementation((...a) => logs.push(a.map(String).join(' ')));
});
afterEach(() => vi.restoreAllMocks());

describe('bearerToken / secretMatches', () => {
	it('parses only a well-formed Bearer header', () => {
		expect(bearerToken('Bearer abc')).toBe('abc');
		expect(bearerToken('bearer   abc  ')).toBe('abc');
		for (const h of [undefined, null, '', 'abc', 'Basic abc', 'Bearer', 'Bearer a b', 'Bearer ']) expect(bearerToken(h), String(h)).toBe('');
	});
	it('matches equal values only; empty or missing never matches', async () => {
		expect(await secretMatches(SECRET, SECRET)).toBe(true);
		expect(await secretMatches(SECRET + 'x', SECRET)).toBe(false);
		expect(await secretMatches(SECRET.slice(0, -1), SECRET)).toBe(false);
		expect(await secretMatches('', '')).toBe(false);
		expect(await secretMatches('', SECRET)).toBe(false);
		expect(await secretMatches(SECRET, '')).toBe(false);
		expect(await secretMatches(SECRET, undefined)).toBe(false);
		expect(await secretMatches(undefined, undefined)).toBe(false);
	});
});

describe('POST /init authentication', () => {
	it('correct Bearer secret → 200 "success" and the database is initialised', async () => {
		const { res, touched } = await call('POST', '/init', { headers: { authorization: `Bearer ${SECRET}` } });
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('success');
		expect(touched.count).toBeGreaterThan(0);
	});
	it('missing, wrong, malformed or differently-cased-scheme headers → 401 and no database access', async () => {
		const bad = [{}, { authorization: '' }, { authorization: 'Bearer ' }, { authorization: `Bearer ${SECRET}x` }, { authorization: `Bearer ${SECRET.slice(1)}` }, { authorization: SECRET }, { authorization: `Basic ${SECRET}` }, { 'x-init-secret': SECRET }];
		for (const headers of bad) {
			const { res, touched } = await call('POST', '/init', { headers });
			expect(res.status, JSON.stringify(headers)).toBe(401);
			expect(await res.text()).toBe('Unauthorized');
			expect(res.headers.get('www-authenticate')).toBe('Bearer');
			expect(res.headers.get('cache-control')).toBe('no-store');
			expect(touched.count).toBe(0);
		}
	});
	it('jwt_secret binding missing or empty → 401 even with an empty or matching-looking header', async () => {
		for (const env of [{ jwt_secret: undefined }, { jwt_secret: '' }]) {
			for (const headers of [{}, { authorization: 'Bearer ' }, { authorization: 'Bearer undefined' }]) {
				const { res, touched } = await call('POST', '/init', { headers, env });
				expect(res.status).toBe(401);
				expect(touched.count).toBe(0);
			}
		}
	});
	it('the secret is not accepted in the URL: old GET /init/<secret> and query strings do nothing', async () => {
		for (const [m, p] of [['GET', `/init/${SECRET}`], ['GET', '/init'], ['POST', `/init/${SECRET}`], ['POST', `/init?secret=${SECRET}`], ['POST', `/init?jwt_secret=${SECRET}`], ['PUT', '/init'], ['DELETE', '/init']]) {
			const { res, touched } = await call(m, p);
			expect(res.status, `${m} ${p}`).not.toBe(200);
			expect(await res.text()).not.toBe('success');
			expect(touched.count).toBe(0);
		}
	});
	it('never writes the secret (or the Authorization header) to the logs or the response', async () => {
		const wrong = 'wrong-secret-0123456789-abcdefghijklmnopqrstu';
		for (const headers of [{ authorization: `Bearer ${wrong}` }, { authorization: `Bearer ${SECRET}` }, {}]) {
			const { res } = await call('POST', '/init', { headers });
			const body = await res.text();
			expect(body).not.toContain(SECRET);
			expect(body).not.toContain(wrong);
		}
		await call('POST', '/init', { env: { jwt_secret: undefined } });
		const all = logs.join('\n');
		expect(all).not.toContain(SECRET);
		expect(all).not.toContain(wrong);
		expect(all).not.toMatch(/Bearer\s+\S{8,}/);
	});
});

describe('repository guards (no secret in config, no auto deploy, no secret in URLs)', () => {
	const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
	const workflow = read('../../.github/workflows/deploy-cloudflare.yml');
	const toml = read('../wrangler-action.toml');

	it('wrangler-action.toml has no plain jwt_secret and no JWT_SECRET placeholder', () => {
		expect(toml).not.toMatch(/^\s*jwt_secret\s*=/m);
		expect(toml).not.toContain('${JWT_SECRET}');
	});
	it('the workflow is manual only: no push / pull_request / schedule triggers', () => {
		const on = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\njobs:'));
		expect(on).toContain('workflow_dispatch');
		expect(on).not.toMatch(/^\s{2}(push|pull_request|pull_request_target|schedule|workflow_run|release):/m);
		expect(workflow).toMatch(/inputs\.confirm == 'deploy-production'/);
		expect(workflow).toMatch(/github\.ref == 'refs\/heads\/main'/);
	});
	it('the secret goes to Cloudflare through --secrets-file, never into the config or a URL', () => {
		expect(workflow).toMatch(/wrangler deploy .*--secrets-file/);
		expect(workflow).not.toMatch(/sed .*JWT_SECRET/);
		expect(workflow).not.toMatch(/\/api\/init\/\$/);
		expect(workflow).toMatch(/--request POST/);
		expect(workflow).toMatch(/Authorization: Bearer/);
		expect(workflow).toMatch(/umask 077/);
		expect(workflow).toMatch(/chmod 600/);
		expect(workflow).toMatch(/if: always\(\)[\s\S]*shred -u/);
	});
	it('JWT_SECRET / CLOUDFLARE_API_TOKEN are never job-level env, and secrets are not read from plain variables', () => {
		const jobEnv = workflow.slice(workflow.indexOf('\n    env:'), workflow.indexOf('\n    outputs:'));
		expect(jobEnv).not.toContain('JWT_SECRET');
		expect(jobEnv).not.toContain('CLOUDFLARE_API_TOKEN');
		expect(workflow).not.toMatch(/secrets\.JWT_SECRET\s*\|\|/);
		expect(workflow).not.toMatch(/vars\.JWT_SECRET|vars\.CLOUDFLARE_API_TOKEN/);
	});
	it('no secret value or echo of it in the workflow; no unpinned third-party action', () => {
		expect(workflow).not.toMatch(/echo[^\n]*\$\{?JWT_SECRET/);
		expect(workflow).not.toMatch(/uses:\s*GitRML/);
		expect(workflow).not.toMatch(/uses:\s*\S+@(main|master)\b/);
	});
	it('no committed secret-looking Cloudflare token', () => {
		for (const text of [workflow, toml]) expect(text).not.toMatch(/\b[A-Za-z0-9_-]{40}\b(?=.*API_TOKEN)/);
	});
});
