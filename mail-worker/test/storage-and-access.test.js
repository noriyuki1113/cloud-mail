import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ setting: {} }));
vi.mock('../src/service/setting-service', () => ({ default: { query: vi.fn(async () => state.setting), refresh: vi.fn() } }));

const { default: r2Service } = await import('../src/service/r2-service.js');
const { default: app } = await import('../src/hono/webs.js');

const kvStore = () => {
	const m = new Map();
	return { m, put: vi.fn(async (k, v, o) => { m.set(k, { value: v, metadata: o?.metadata }); }), get: vi.fn(async (k) => m.get(k)?.value ?? null), getWithMetadata: vi.fn(async (k) => m.get(k) ?? { value: null }), delete: vi.fn(async (k) => { m.delete(k); }) };
};

beforeEach(() => { state.setting = { bucket: '', endpoint: '', s3AccessKey: '', s3SecretKey: '' }; });

describe('storage without an R2 bucket (R2_BUCKET_NAME unset → no `r2` binding)', () => {
	it('falls back to KV; with an r2 binding it uses R2; with S3 settings it uses S3', async () => {
		expect(await r2Service.storageType({ env: { kv: kvStore() } })).toBe('KV');
		expect(await r2Service.storageType({ env: { kv: kvStore(), r2: {} } })).toBe('R2');
		state.setting = { bucket: 'b', endpoint: 'https://s3.example.test', s3AccessKey: 'k', s3SecretKey: 's' };
		expect(await r2Service.storageType({ env: { kv: kvStore(), r2: {} } })).toBe('S3');
	});
	it('attachments are written to and read back from KV without throwing', async () => {
		const kv = kvStore();
		const c = { env: { kv } };
		await r2Service.putObj(c, 'attachments/abc.pdf', new Uint8Array([1, 2, 3]), { contentType: 'application/pdf' });
		expect(kv.put).toHaveBeenCalledTimes(1);
		const res = await r2Service.getObj(c, 'attachments/abc.pdf');
		expect(res.headers.get('content-type')).toBe('application/pdf');
		expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3]);
		expect(await r2Service.getObj(c, 'attachments/missing')).toBeNull();
	});
});

describe('the management API is closed to anonymous callers', () => {
	const env = () => ({ jwt_secret: 'unit-test-secret-0123456789-abcdefghijklmnop', admin: 'admin@muselora.jp', domain: ['muselora.jp'], kv: kvStore(), db: {} });
	const call = (method, path, headers = {}) => app.request(path, { method, headers, body: method === 'POST' ? '{}' : undefined }, env());

	it('admin, user, setting and mailbox routes answer 401 (auth required) without a valid session', async () => {
		const routes = [['GET', '/setting/query'], ['POST', '/setting/set'], ['GET', '/user/list'], ['POST', '/user/add'], ['POST', '/user/setType'], ['GET', '/role/list'], ['GET', '/regKey/list'], ['GET', '/allEmail/list'], ['GET', '/email/list'], ['GET', '/account/list'], ['GET', '/analysis/echarts']];
		for (const [m, p] of routes) {
			const res = await call(m, p);
			const body = await res.json();
			expect(body.code, `${m} ${p}`).toBe(401);
		}
	});
	it('a forged or malformed token is rejected', async () => {
		for (const authorization of ['x', 'a.b.c', 'Bearer a.b.c', 'eyJhbGciOiJIUzI1NiJ9.e30.AAAA']) {
			const body = await (await call('GET', '/setting/query', { authorization })).json();
			expect(body.code, authorization).toBe(401);
		}
	});
	it('the public API needs the admin-issued public token; none exists on a fresh installation', async () => {
		for (const [m, p] of [['POST', '/public/emailList'], ['POST', '/public/addUser']]) {
			for (const headers of [{}, { authorization: 'anything' }, { authorization: '' }]) {
				const body = await (await call(m, p, headers)).json();
				expect(body.code, `${p} ${JSON.stringify(headers)}`).toBe(401);
			}
		}
	});
	it('the public token endpoint issues no token to a non-admin account', async () => {
		const res = await app.request('/public/genToken', { method: 'POST', body: JSON.stringify({ email: 'someone@muselora.jp', password: 'x' }) }, env());
		const body = await res.json();
		expect(body.code).not.toBe(200);
		expect(body.data?.token).toBeUndefined();
	});
});
