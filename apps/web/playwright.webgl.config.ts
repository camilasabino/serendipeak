import { defineConfig } from '@playwright/test';
import { STUB_API_PORT, WEB_PORT } from './e2e/support/ports';

const PRODUCTION = process.env.WEBGL_SERVER === 'production';

// Every NEXT_PUBLIC_* value is inlined at build time, and the camera diagnostic exists only in a
// build that sets NEXT_PUBLIC_E2E_DIAGNOSTICS, so this suite never shares the ssr suite's build.
const webEnvironment = {
	NEXT_DIST_DIR: '.next-e2e',
	NEXT_TELEMETRY_DISABLED: '1',
	NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${STUB_API_PORT}`,
	NEXT_PUBLIC_CESIUM_ION_TOKEN: 'e2e-intercepted',
	NEXT_PUBLIC_CESIUM_IMAGERY_MODE: 'sentinel2',
	NEXT_PUBLIC_E2E_DIAGNOSTICS: '1'
};

const host = `--hostname 127.0.0.1 --port ${WEB_PORT}`;

// Development exercises React Strict Mode's double effects; production proves the shipped bundle.
export default defineConfig({
	testDir: './e2e/webgl',
	workers: 1,
	timeout: 120_000,
	expect: { timeout: 15_000 },
	use: { baseURL: `http://127.0.0.1:${WEB_PORT}` },
	projects: [{ name: 'webgl', grep: /@webgl/, use: { browserName: 'chromium' } }],
	webServer: [
		{
			command: 'node e2e/stub-api/server.mjs',
			url: `http://127.0.0.1:${STUB_API_PORT}/__control/requests`,
			env: { STUB_API_PORT: String(STUB_API_PORT) }
		},
		{
			command: PRODUCTION ? `next build && next start ${host}` : `next dev ${host}`,
			url: `http://127.0.0.1:${WEB_PORT}/`,
			timeout: 300_000,
			env: webEnvironment
		}
	]
});
