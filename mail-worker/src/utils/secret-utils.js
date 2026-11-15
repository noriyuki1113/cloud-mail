// Helpers for checking a shared secret sent in an HTTP header (never in a URL).

/** Extracts the token from "Authorization: Bearer <token>". Returns '' when absent or malformed. */
export function bearerToken(header) {
	if (typeof header !== 'string') return '';
	const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header);
	return m ? m[1] : '';
}

const digest = async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

/**
 * Constant-time comparison. Both sides are hashed first, so the comparison time does not depend on
 * the length or content of either value. An empty or missing expected/provided value never matches
 * (an unset binding must not be satisfiable by an empty header).
 */
export async function secretMatches(provided, expected) {
	if (typeof provided !== 'string' || typeof expected !== 'string') return false;
	if (provided.length === 0 || expected.length === 0) return false;
	const [a, b] = await Promise.all([digest(provided), digest(expected)]);
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}
