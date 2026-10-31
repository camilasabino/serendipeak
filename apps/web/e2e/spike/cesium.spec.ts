import { expect, test } from '@playwright/test';

const WORKER_SCRIPTS = [
	'createVerticesFromHeightmap',
	'createEllipsoidGeometry',
	'combineGeometry'
];

test('Cesium initializes a globe with workers and assets from CESIUM_BASE_URL', async ({
	page,
	baseURL
}) => {
	const origin = new URL(baseURL!).origin;
	const external: string[] = [];
	const failed: string[] = [];
	const cesiumAssets: string[] = [];
	const errors: string[] = [];

	await page.route(
		(url) => url.origin !== origin,
		(route) => {
			external.push(route.request().url());
			return route.abort();
		}
	);
	page.on('requestfailed', (request) =>
		failed.push(`${request.url()} ${request.failure()?.errorText}`)
	);
	page.on('response', (response) => {
		const url = new URL(response.url());
		if (response.status() >= 400) {
			failed.push(`${response.url()} ${response.status()}`);
		} else if (url.pathname.startsWith('/cesium/')) {
			cesiumAssets.push(url.pathname);
		}
	});
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') {
			errors.push(message.text());
		}
	});

	await page.goto('/spike/cesium');

	const state = page.getByTestId('cesium-spike-state');
	await expect(state).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
	await expect(state).toContainText(`${origin}/cesium/Workers/`);
	await expect(page.locator('canvas')).toHaveCount(1);

	await expect
		.poll(() =>
			WORKER_SCRIPTS.filter((name) => !cesiumAssets.includes(`/cesium/Workers/${name}.js`))
		)
		.toEqual([]);
	expect(cesiumAssets).toContain('/cesium/Widgets/widgets.css');
	expect(cesiumAssets.some((path) => path.startsWith('/cesium/Assets/'))).toBe(true);

	expect(failed).toEqual([]);
	expect(external).toEqual([]);
	expect(errors).toEqual([]);
});

test('production server serves ThirdParty decoders under CESIUM_BASE_URL', async ({ request }) => {
	for (const name of ['draco_decoder.wasm', 'basis_transcoder.wasm']) {
		const response = await request.get(`/cesium/ThirdParty/${name}`);
		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toBe('application/wasm');
	}
});
