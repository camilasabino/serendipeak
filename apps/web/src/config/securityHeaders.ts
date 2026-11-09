export interface HeaderRule {
	source: string;
	headers: { key: string; value: string }[];
}

// Directives that govern no resource fetch, so they cannot affect Cesium, WebGL or the editor.
const ENFORCED_POLICY = [
	"base-uri 'self'",
	"form-action 'self'",
	"frame-ancestors 'none'",
	"object-src 'none'"
].join('; ');

// Only fullscreen is used (the stage's fullscreen button); everything else is closed.
const PERMISSIONS_POLICY = [
	'accelerometer=()',
	'autoplay=()',
	'camera=()',
	'display-capture=()',
	'fullscreen=(self)',
	'geolocation=()',
	'gyroscope=()',
	'magnetometer=()',
	'microphone=()',
	'midi=()',
	'payment=()',
	'publickey-credentials-get=()',
	'serial=()',
	'usb=()',
	'xr-spatial-tracking=()'
].join(', ');

// Cesium Ion: the endpoint, the terrain and imagery assets, and the Bing tiles that the production
// imagery is served from. This is the part that cannot be proven without the real Ion token and
// network, which is why the policy is report-only.
const ION_ORIGINS = [
	'https://api.cesium.com',
	'https://assets.ion.cesium.com',
	'https://*.cesium.com',
	'https://*.virtualearth.net'
];

function originOf(url: string | undefined): string | undefined {
	try {
		return url ? new URL(url).origin : undefined;
	} catch {
		return undefined;
	}
}

// The policy the site could enforce once the Ion and media origins are proven. Scripts need
// 'unsafe-inline' because the production build inlines a bootstrap script and Pages Router has no
// per-build hash support; dropping it needs per-request nonces, which makes every page dynamic.
// Style needs it because Cesium positions its widgets with style attributes.
export function reportOnlyPolicy(apiBaseUrl: string | undefined): string {
	const connect = ["'self'", originOf(apiBaseUrl), ...ION_ORIGINS].filter(Boolean).join(' ');

	return [
		"default-src 'self'",
		"script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
		"worker-src 'self' blob:",
		"style-src 'self' 'unsafe-inline'",
		// Photograph renditions come from a media host the web build does not know.
		"img-src 'self' data: blob: https:",
		"font-src 'self' data:",
		`connect-src ${connect}`,
		"manifest-src 'self'",
		...ENFORCED_POLICY.split('; ')
	].join('; ');
}

// Never indexed and never shared-cached: the editor reads a draft from its query string and the
// preview entry page handles a credential in its fragment.
const EDITORIAL_SOURCES = ['/preview', '/editorial/camera', '/api/preview'];

// Their query strings and fragments carry draft names, coordinates, camera values and a credential,
// so no Referer may carry them. Listed after the site-wide rule so it wins. The editor keeps the
// origin: Cesium ion rejects a URL-restricted token on a request with no Referer header.
const REFERRER_POLICIES: Record<string, string | undefined> = {
	'/preview': 'no-referrer',
	'/editorial/camera': 'strict-origin'
};

function referrerPolicyHeader(source: string): HeaderRule['headers'] {
	const value = REFERRER_POLICIES[source];
	return value ? [{ key: 'Referrer-Policy', value }] : [];
}

export function securityHeaderRules(apiBaseUrl: string | undefined): HeaderRule[] {
	return [
		{
			source: '/:path*',
			headers: [
				{ key: 'X-Content-Type-Options', value: 'nosniff' },
				{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
				{ key: 'X-Frame-Options', value: 'DENY' },
				{ key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
				{ key: 'Content-Security-Policy', value: ENFORCED_POLICY },
				{ key: 'Content-Security-Policy-Report-Only', value: reportOnlyPolicy(apiBaseUrl) }
			]
		},
		...EDITORIAL_SOURCES.map((source) => ({
			source,
			headers: [
				{ key: 'X-Robots-Tag', value: 'noindex, nofollow' },
				{ key: 'Cache-Control', value: 'no-store' },
				...referrerPolicyHeader(source)
			]
		}))
	];
}
