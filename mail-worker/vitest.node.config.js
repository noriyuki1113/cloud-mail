// Plain Node unit tests (no Workers runtime, no deployment). Run: pnpm test:unit
// (The legacy "test" script deploys a Worker and the workers-pool config points to a missing wrangler.jsonc.)
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.js'],
		environment: 'node'
	}
});
