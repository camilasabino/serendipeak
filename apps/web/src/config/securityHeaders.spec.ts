import { describe, expect, it } from 'vitest';
import { reportOnlyPolicy, securityHeaderRules } from './securityHeaders';

const API = 'https://api.example.dev/';

function headersOf(source: string): Map<string, string> {
	const rules = securityHeaderRules(API).filter((rule) => rule.source === source);

	return new Map(rules.flatMap((rule) => rule.headers.map(({ key, value }) => [key, value])));
}

describe('site-wide security headers', () => {
	const site = headersOf('/:path*');

	it('forbids sniffing and framing and limits the referrer', () => {
		expect(site.get('X-Content-Type-Options')).toBe('nosniff');
		expect(site.get('X-Frame-Options')).toBe('DENY');
		expect(site.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
	});

	it('never sends HSTS, which has its own rollout', () => {
		expect(site.has('Strict-Transport-Security')).toBe(false);
	});

	it('closes every powerful feature except fullscreen', () => {
		const policy = site.get('Permissions-Policy') ?? '';

		expect(policy).toContain('fullscreen=(self)');
		expect(policy).toContain('camera=()');
		expect(policy).toContain('geolocation=()');
		expect(policy).not.toMatch(/=\*/);
	});

	it('enforces only directives that fetch nothing', () => {
		const enforced = site.get('Content-Security-Policy') ?? '';

		expect(enforced).toContain("frame-ancestors 'none'");
		expect(enforced).toContain("object-src 'none'");
		expect(enforced).not.toMatch(/script-src|default-src|connect-src|img-src|worker-src/);
	});
});

describe('report-only policy', () => {
	const policy = reportOnlyPolicy(API);

	it('covers what Cesium needs without unsafe-eval', () => {
		expect(policy).toContain("script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'");
		expect(policy).toContain("worker-src 'self' blob:");
		expect(policy).not.toContain("'unsafe-eval'");
	});

	it('allows the API origin, not its path', () => {
		expect(policy).toContain("connect-src 'self' https://api.example.dev https://api.cesium.com");
	});

	it('survives a missing or malformed API origin', () => {
		expect(reportOnlyPolicy(undefined)).toContain("connect-src 'self' https://api.cesium.com");
		expect(reportOnlyPolicy('nonsense')).toContain("connect-src 'self' https://api.cesium.com");
	});

	it('is sent beside the enforced policy, not in place of it', () => {
		const keys = headersOf('/:path*');

		expect(keys.get('Content-Security-Policy-Report-Only')).toBe(policy);
	});
});

describe('editorial routes', () => {
	it.each(['/preview', '/editorial/camera', '/api/preview'])(
		'%s is unindexed and unstored',
		(route) => {
			const headers = headersOf(route);

			expect(headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
			expect(headers.get('Cache-Control')).toBe('no-store');
		}
	);
});

describe('referrer policy', () => {
	it.each(['/preview', '/editorial/camera'])(
		'%s sends no referrer, after the site-wide rule',
		(route) => {
			const rules = securityHeaderRules(API);
			const index = (source: string) => rules.findIndex((rule) => rule.source === source);

			expect(headersOf(route).get('Referrer-Policy')).toBe('no-referrer');
			expect(index(route)).toBeGreaterThan(index('/:path*'));
		}
	);

	it('leaves the site-wide policy and the API exchange route unchanged', () => {
		expect(headersOf('/:path*').get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
		expect(headersOf('/api/preview').has('Referrer-Policy')).toBe(false);
	});
});
