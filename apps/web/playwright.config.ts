import { defineConfig } from '@playwright/test';
import { STUB_API_PORT, WEB_PORT } from './e2e/support/ports';

// WebGL scene tests live in playwright.webgl.config.ts: they need a different build and server.
export default defineConfig({
	testDir: './e2e',
	testIgnore: /webgl\//,
	workers: 1,
	use: { baseURL: `http://127.0.0.1:${WEB_PORT}` },
	projects: [
		{ name: 'ssr', testMatch: /ssr\/.*\.spec\.ts/, use: { browserName: 'chromium' } },
		{ name: 'nogl', grep: /@nogl/, use: { browserName: 'chromium' } }
	],
	webServer: [
		{
			command: 'node e2e/stub-api/server.mjs',
			url: `http://127.0.0.1:${STUB_API_PORT}/__control/requests`,
			env: { STUB_API_PORT: String(STUB_API_PORT) }
		},
		{
			// The build must have inlined NEXT_PUBLIC_API_BASE_URL for the stub (npm run test:ssr).
			command: `next start --hostname 127.0.0.1 --port ${WEB_PORT}`,
			url: `http://127.0.0.1:${WEB_PORT}/`
		}
	]
});
