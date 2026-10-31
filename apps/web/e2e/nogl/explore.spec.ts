import { expect, test, type Page, type Route } from '@playwright/test';
import { fixture, resetStub, stubRequests, useScenario } from '../ssr/support';

interface Named {
	slug: string;
	name: string;
}

const ACONCAGUA = fixture<Named>('mountain-complete.json');
const BARE_PEAK = fixture<Named>('mountain-minimal.json');
const DAILY = fixture<{ mountain: Named }>('daily-mountain.json').mountain;

const RANDOM_ENDPOINT = '**/api/v1/mountains/random**';

function isLocal(url: URL): boolean {
	return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
}

// The stage has no 3D here, so Explore must work on editorial navigation alone.
async function watch(page: Page) {
	const documents: string[] = [];
	const pageErrors: string[] = [];

	page.on('pageerror', (error) => pageErrors.push(error.message));
	page.on('request', (request) => {
		if (request.resourceType() === 'document') documents.push(request.url());
	});
	await page.route(
		(url) => !isLocal(url),
		(route) => route.abort('blockedbyclient')
	);

	return { documents, pageErrors };
}

const exploreButton = (page: Page) =>
	page.getByRole('button', { name: /^Explore another|^Exploring/ });

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('@nogl Explore', () => {
	test('travels to another mountain by client navigation and becomes usable again', async ({
		page,
		request
	}) => {
		const watched = await watch(page);
		await page.goto(`/mountains/${ACONCAGUA.slug}`);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(ACONCAGUA.name);
		await page.locator('main').evaluate((main) => main.setAttribute('data-probe', 'persistent'));
		const documentsBefore = watched.documents.length;

		await exploreButton(page).click();

		await expect(page).toHaveURL(new RegExp(`/mountains/${BARE_PEAK.slug}$`));
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(BARE_PEAK.name);
		await expect(exploreButton(page)).toHaveAttribute('aria-busy', 'false');
		await expect(exploreButton(page)).toHaveText(/^Explore another/);
		await expect(page.locator('main[data-probe="persistent"]')).toHaveCount(1);
		expect(watched.documents.length).toBe(documentsBefore);
		expect(await stubRequests(request)).toContain(
			`/api/v1/mountains/random?exclude=${ACONCAGUA.slug}`
		);
		expect(watched.pageErrors).toEqual([]);
	});

	test('keeps the daily identity: / still serves today’s mountain after exploring from it', async ({
		page
	}) => {
		await watch(page);
		await page.goto('/');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(DAILY.name);

		await exploreButton(page).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${BARE_PEAK.slug}$`));
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(BARE_PEAK.name);

		await page.goto('/');
		await expect(page).toHaveURL(/\/$/);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(DAILY.name);
	});

	test('is busy once while the destination is being chosen and ignores repeated clicks', async ({
		page,
		request
	}) => {
		await watch(page);
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		await page.route(RANDOM_ENDPOINT, async (route: Route) => {
			await gate;
			await route.continue();
		});
		await page.goto(`/mountains/${ACONCAGUA.slug}`);

		const button = exploreButton(page);
		await button.click();
		await expect(button).toHaveAttribute('aria-busy', 'true');
		await expect(button).toHaveAttribute('aria-disabled', 'true');
		await expect(button).toHaveText('Exploring…');
		// Playwright waits out aria-disabled; force dispatches the clicks a real user could still make.
		await button.click({ force: true });
		await button.click({ force: true });
		release();

		await expect(page).toHaveURL(new RegExp(`/mountains/${BARE_PEAK.slug}$`));
		await expect(exploreButton(page)).toHaveAttribute('aria-busy', 'false');
		const randoms = (await stubRequests(request)).filter((url) => url.includes('/random'));
		expect(randoms).toHaveLength(1);
	});

	for (const [scenario, message] of [
		['unreachable', 'Mountain data is unavailable right now. Try again.'],
		['server-error', 'Another mountain could not be loaded. Try again.'],
		['malformed', 'Another mountain could not be loaded. Try again.'],
		['no-eligible', 'No mountain is available right now.']
	] as const) {
		test(`reports a ${scenario} lookup locally, stays on the mountain and recovers`, async ({
			page,
			request
		}) => {
			const watched = await watch(page);
			await page.goto(`/mountains/${ACONCAGUA.slug}`);
			await useScenario(request, scenario);

			await exploreButton(page).click();

			const alert = page.locator('header').getByRole('alert');
			await expect(alert).toHaveText(message);
			await expect(alert).not.toContainText(/50\d|error|stack/i);
			await expect(exploreButton(page)).toHaveAttribute('aria-busy', 'false');
			await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
			await expect(page.getByRole('heading', { level: 1 })).toHaveText(ACONCAGUA.name);

			await useScenario(request, 'ok');
			await exploreButton(page).click();

			await expect(page).toHaveURL(new RegExp(`/mountains/${BARE_PEAK.slug}$`));
			await expect(page.locator('header').getByRole('alert')).toHaveCount(0);
			expect(watched.pageErrors).toEqual([]);
		});
	}
});
