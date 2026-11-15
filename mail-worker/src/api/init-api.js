import app from '../hono/hono';
import { dbInit } from '../init/init';

// POST only, authenticated by the Authorization header (see src/init/init.js).
// The former GET /init/:secret put the secret in the URL and was removed on purpose.
app.post('/init', (c) => {
	return dbInit.init(c);
})
