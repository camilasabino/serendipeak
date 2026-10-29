import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	workers: 1,
	projects: [
		{ name: 'nogl', grep: /@nogl/, use: { browserName: 'chromium' } },
		{ name: 'webgl', grep: /@webgl/, use: { browserName: 'chromium' } }
	]
});
