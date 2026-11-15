import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../src/service/setting-service', () => ({ default: { refresh: vi.fn(async () => {}) } }));
const { default: app } = await import('../src/hono/hono.js');
await import('../src/api/init-api.js');

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const workflow = read('../../.github/workflows/deploy-cloudflare.yml');
const toml = read('../wrangler-action.toml');
const steps = workflow.split(/\n      - name: /).slice(1);
const step = (title) => steps.find((s) => s.startsWith(title)) ?? '';
const indexOfStep = (title) => steps.findIndex((s) => s.startsWith(title));

describe('fresh installation defaults', () => {
	it('public sign-up is CLOSED on a new database (the setting row is created with register = 1)', async () => {
		const sql = [];
		const stmt = (q) => { const s = { bind: () => s, run: async () => { sql.push(q); return {}; }, all: async () => { sql.push(q); return { results: [] }; }, first: async () => { sql.push(q); return new Proxy({}, { get: () => 0 }); } }; return s; };
		const db = { prepare: stmt, batch: async () => [], exec: async () => {} };
		const secret = 'unit-test-secret-0123456789-abcdefghijklmnop';
		const res = await app.request('/init', { method: 'POST', headers: { authorization: `Bearer ${secret}` } }, { jwt_secret: secret, db, kv: {} });
		expect(res.status).toBe(200);
		const insert = sql.find((q) => /INSERT INTO setting/.test(q) && /SELECT/.test(q));
		expect(insert).toBeTruthy();
		expect(insert).toMatch(/SELECT\s+1,\s*0,\s*0,\s*0,\s*'Cloud Mail'/); // register = 1 (CLOSE)
	});
});

describe('D1 / KV are reused, never silently duplicated', () => {
	it('the D1 name comes from the workflow (default muselora-mail), not a hard-coded cloud-mail', () => {
		expect(toml).toContain('database_name = "${D1_DATABASE_NAME}"');
		expect(toml).not.toMatch(/database_name\s*=\s*"cloud-mail"/);
		expect(workflow).toMatch(/D1_DATABASE_NAME: \$\{\{ vars\.D1_DATABASE_NAME \|\| 'muselora-mail' \}\}/);
	});
	it('the D1 step looks the database up by name, verifies an explicit id, and creates only when explicitly allowed', () => {
		const d1 = step('🐬 Set up D1 database');
		expect(d1).toContain('d1 list --json');
		expect(d1).toMatch(/select\(\.name == \$n\)/);
		expect(d1).toMatch(/D1_DATABASE_ID does not match any database/);
		expect(d1).toMatch(/\[ "\$CREATE_MISSING" != "true" \][\s\S]*exit 1/);
		expect(d1.indexOf('d1 create')).toBeGreaterThan(d1.indexOf('CREATE_MISSING'));
	});
	it('the KV step verifies an explicit id and creates only when explicitly allowed', () => {
		const kv = step('⚡ Set up KV database');
		expect(kv).toMatch(/KV_NAMESPACE_ID does not match any KV namespace/);
		expect(kv).toMatch(/\[ "\$CREATE_MISSING" != "true" \][\s\S]*exit 1/);
		expect(kv.indexOf('kv namespace create')).toBeGreaterThan(kv.indexOf('CREATE_MISSING'));
	});
	it('create_missing_resources defaults to false', () => {
		expect(workflow).toMatch(/create_missing_resources:[\s\S]*?default: false/);
	});
});

describe('front end is built once, without credentials, and wrangler does not rebuild', () => {
	it('the deploy config has no [build] section', () => {
		expect(toml).not.toMatch(/^\[build\]/m);
		expect(toml).not.toMatch(/^command\s*=/m);
		expect(step('🛠️ Set up environment')).toMatch(/must not contain a \[build\] section/);
	});
	it('a dedicated build step exists, uses pnpm -C (not --prefix), and checks the output', () => {
		const build = step('🎨 Build front end');
		expect(build).toContain('pnpm -C ./mail-vue install --frozen-lockfile');
		expect(build).toContain('pnpm -C ./mail-vue run build');
		expect(build).toContain('./mail-worker/dist/index.html');
		expect(build).not.toContain('--prefix');
		expect(workflow).not.toContain('--prefix');
	});
	it('the build step has no Cloudflare credential and no JWT secret, and runs before any step that has them', () => {
		const build = step('🎨 Build front end');
		expect(build).not.toMatch(/secrets\.|CLOUDFLARE_API_TOKEN|JWT_SECRET/);
		const b = indexOfStep('🎨 Build front end');
		for (const [i, s] of steps.entries()) {
			if (/secrets\.(CLOUDFLARE_API_TOKEN|JWT_SECRET)/.test(s)) expect(i, s.split('\n')[0]).toBeGreaterThan(b);
		}
		expect(indexOfStep('📦 Install dependencies')).toBeGreaterThanOrEqual(0);
		expect(step('📦 Install dependencies')).not.toMatch(/secrets\./);
	});
	it('the front end build output directory matches the Worker assets directory', () => {
		expect(read('../../mail-vue/.env.release')).toMatch(/VITE_OUT_DIR\s*=\s*\.\.\/mail-worker\/dist/);
		expect(toml).toMatch(/\[assets\][\s\S]*directory = "\.\/dist"/);
	});
});

describe('guards from the previous PR are still in place', () => {
	it('JWT_SECRET stays a Secret binding uploaded with --secrets-file; deploys stay manual', () => {
		expect(toml).not.toMatch(/^\s*jwt_secret\s*=/m);
		expect(workflow).toMatch(/wrangler deploy .*--secrets-file/);
		expect(workflow).toMatch(/inputs\.confirm == 'deploy-production'/);
		const on = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\njobs:'));
		expect(on).not.toMatch(/^\s{2}(push|pull_request|pull_request_target|schedule|workflow_run|release):/m);
	});
});
