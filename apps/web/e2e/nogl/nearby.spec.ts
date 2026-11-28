import { expect, test, type Page } from '@playwright/test';
import { fixture, resetStub, serveMountain, useScenario } from '../ssr/support';

interface Mountain {
	slug: string;
	name: string;
	coordinates: { latitude: number; longitude: number };
}

const ACONCAGUA = fixture<Mountain>('mountain-complete.json');
// The `catalog` index lists this summit 66 km from Aconcagua; its page is served here by slug.
const EL_PLATA: Mountain = {
	...ACONCAGUA,
	slug: 'cerro-el-plata',
	name: 'Cerro El Plata',
	coordinates: { latitude: -33.015925, longitude: -69.454922 }
};

async function watch(page: Page) {
	const pageErrors: string[] = [];
	const documents: string[] = [];

	page.on('pageerror', (error) => pageErrors.push(error.message));
	page.on('request', (request) => {
		if (request.resourceType() === 'document') documents.push(request.url());
	});
	await page.route(
		(url) => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost',
		(route) => route.abort('blockedbyclient')
	);

	return { pageErrors, documents };
}

const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const nearby = (page: Page) => page.getByRole('region', { name: 'Nearby mountains' });
const backToAtlas = (page: Page) => page.getByRole('link', { name: /Back to atlas/ });

async function hydrated(page: Page) {
	await page.waitForFunction(() => '__NEXT_DATA__' in window && 'next' in window);
}

test.beforeEach(async ({ request }) => {
	await resetStub(request);
	await useScenario(request, 'catalog');
	await serveMountain(request, EL_PLATA);
});

test.describe('@nogl Nearby mountains', () => {
	test('follow the mountain as the visitor moves between pages, without a reload', async ({
		page
	}) => {
		const watched = await watch(page);
		await page.goto(`/mountains/${ACONCAGUA.slug}`);
		await hydrated(page);
		await expect(nearby(page).getByRole('link')).toHaveText([
			/Cerro El Plata.*66 km/s,
			/Ojos del Salado.*630 km/s
		]);
		const documents = watched.documents.length;

		await nearby(page)
			.getByRole('link', { name: /Cerro El Plata/ })
			.click();

		await expect(page).toHaveURL(new RegExp(`/mountains/${EL_PLATA.slug}$`));
		await expect(heading(page)).toHaveText(EL_PLATA.name);
		await expect(nearby(page).getByRole('link', { name: /Aconcagua/ })).toBeVisible();
		await expect(nearby(page).getByRole('link', { name: /Cerro El Plata/ })).toHaveCount(0);
		expect(watched.documents.length).toBe(documents);

		await page.goBack();
		await expect(heading(page)).toHaveText(ACONCAGUA.name);
		await expect(nearby(page).getByRole('link', { name: /Cerro El Plata/ })).toBeVisible();
		expect(watched.pageErrors).toEqual([]);
	});

	test('leave Back to atlas as it was: offered where the atlas was left, not on the next mountain', async ({
		page
	}) => {
		await watch(page);
		await page.goto('/atlas');
		await hydrated(page);
		await page
			.getByRole('region', { name: 'Atlas mountains' })
			.locator('summary, button')
			.filter({ hasText: /^South America/ })
			.click();
		await page
			.getByRole('region', { name: 'Atlas mountains' })
			.getByRole('link', { name: /Aconcagua/ })
			.click();
		await expect(heading(page)).toHaveText(ACONCAGUA.name);
		await expect(backToAtlas(page)).toBeVisible();

		await nearby(page)
			.getByRole('link', { name: /Cerro El Plata/ })
			.click();
		await expect(heading(page)).toHaveText(EL_PLATA.name);
		await expect(backToAtlas(page)).toHaveCount(0);

		await page.goBack();
		await expect(heading(page)).toHaveText(ACONCAGUA.name);
		await expect(backToAtlas(page)).toBeVisible();
	});
});
