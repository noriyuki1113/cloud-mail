import { beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'unit-test-secret-0123456789-abcdefghijklmnop'; // fake value
const state = vi.hoisted(() => ({ setting: {}, inserted: [] }));

vi.mock('../src/service/setting-service', () => ({ default: { query: vi.fn(async () => state.setting), refresh: vi.fn() } }));
vi.mock('../src/service/role-service', () => ({
	default: {
		selectDefaultRole: vi.fn(async () => ({ roleId: 1, availDomain: '' })),
		selectById: vi.fn(async () => ({ roleId: 1, availDomain: '' })),
		hasAvailDomainPerm: vi.fn(() => true)
	}
}));
vi.mock('../src/service/account-service', () => ({ default: { selectByEmailIncludeDel: vi.fn(async () => null), insert: vi.fn(async () => 1) } }));
vi.mock('../src/service/user-service', () => ({
	default: {
		insert: vi.fn(async (_c, row) => { state.inserted.push(row.email); return 7; }),
		updateUserInfo: vi.fn(async () => {})
	}
}));
vi.mock('../src/utils/crypto-utils', () => ({ default: { hashPassword: vi.fn(async () => ({ salt: 's', hash: 'h' })), genRandomPwd: () => 'x' } }));
vi.mock('../src/service/turnstile-service', () => ({ default: { verify: vi.fn(async () => {}) } }));
vi.mock('../src/service/reg-key-service', () => ({ default: {} }));
vi.mock('../src/service/verify-record-service', () => ({ default: {} }));

const { default: loginService } = await import('../src/service/login-service.js');

const ADMIN = 'admin@muselora.jp';
const OPEN = 0, CLOSE = 1;
const ctx = (headers = {}, env = {}) => ({
	env: { admin: ADMIN, domain: ['muselora.jp'], jwt_secret: SECRET, ...env },
	req: { header: (n) => headers[n.toLowerCase()] }
});
const reg = (c, email, oauth = false) => loginService.register(c, { email, password: 'a-long-enough-password', code: '' }, oauth);
const settings = (register) => ({ register, registerVerify: CLOSE, regKey: CLOSE, regVerifyCount: 0, minEmailPrefix: 1, emailPrefixFilter: [] });

beforeEach(() => { state.inserted.length = 0; });

describe('administrator account cannot be claimed through sign-up', () => {
	it('registration closed (the default of a fresh installation): ordinary users are refused', async () => {
		state.setting = settings(CLOSE);
		await expect(reg(ctx(), 'someone@muselora.jp')).rejects.toThrow(/Sign up is disabled|注册功能已关闭/);
		expect(state.inserted).toEqual([]);
	});
	it('registration open: ordinary users still register (baseline)', async () => {
		state.setting = settings(OPEN);
		await reg(ctx(), 'someone@muselora.jp');
		expect(state.inserted).toEqual(['someone@muselora.jp']);
	});
	it('registration open: the ADMIN address is refused without the deployment secret (any letter case, any header)', async () => {
		state.setting = settings(OPEN);
		const attempts = [
			[ADMIN, {}], ['Admin@muselora.jp', {}], [' ADMIN@MUSELORA.JP ', {}],
			[ADMIN, { authorization: 'Bearer wrong-secret-wrong-secret-wrong-secret' }],
			[ADMIN, { authorization: SECRET }], [ADMIN, { authorization: 'Bearer ' }], [ADMIN, { 'x-init-secret': SECRET }]
		];
		for (const [email, headers] of attempts) {
			await expect(reg(ctx(headers), email), `${email} ${JSON.stringify(headers)}`).rejects.toMatchObject({ code: 403 });
		}
		expect(state.inserted).toEqual([]);
	});
	it('registration closed: the ADMIN address registers once with the deployment secret as a Bearer header', async () => {
		state.setting = settings(CLOSE);
		await reg(ctx({ authorization: `Bearer ${SECRET}` }), ADMIN);
		expect(state.inserted).toEqual([ADMIN]);
	});
	it('the bootstrap secret does not open registration for anybody else', async () => {
		state.setting = settings(CLOSE);
		await expect(reg(ctx({ authorization: `Bearer ${SECRET}` }), 'someone@muselora.jp')).rejects.toThrow(/Sign up is disabled|注册功能已关闭/);
		expect(state.inserted).toEqual([]);
	});
	it('OAuth sign-up can never create the ADMIN account', async () => {
		state.setting = settings(OPEN);
		await expect(reg(ctx({ authorization: `Bearer ${SECRET}` }), ADMIN, true)).rejects.toMatchObject({ code: 403 });
		expect(state.inserted).toEqual([]);
	});
	it('an unset jwt_secret binding never satisfies the bootstrap', async () => {
		state.setting = settings(OPEN);
		for (const jwt_secret of [undefined, '']) {
			await expect(reg(ctx({ authorization: 'Bearer ' }, { jwt_secret }), ADMIN)).rejects.toMatchObject({ code: 403 });
		}
		expect(state.inserted).toEqual([]);
	});
	it('without a configured ADMIN there is no special address', async () => {
		state.setting = settings(OPEN);
		await reg(ctx({}, { admin: undefined }), 'someone@muselora.jp');
		expect(state.inserted).toEqual(['someone@muselora.jp']);
	});
	it('addresses outside the mail domain are refused as before', async () => {
		state.setting = settings(OPEN);
		await expect(reg(ctx(), 'x@evil.example')).rejects.toThrow();
		expect(state.inserted).toEqual([]);
	});
});
