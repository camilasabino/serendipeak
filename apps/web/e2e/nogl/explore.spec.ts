import { expect, test, type Page, type Route } from '@playwright/test';
import { fixture, resetStub, stubRequests, useScenario } from '../ssr/support';

interface Named {
	slug: string;
	name: string;
}

const ACONCAGUA = fixture<Named>('mountain-complete.json');
const BARE_PEAK = fixture<Named>('mountain-minimal.json');
const OLYMPUS = fixture<Named>('mountain-sparse.json');
const DAILY = fixture<{ mountain: Named }>('daily-mountain.json').mountain;
const BARE_PEAK_RECORD = fixture<unknown>('mountain-minimal.json');

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

type NextWindow = Window & { next?: { router: { push(url: string): Promise<boolean> } } };

function deferred() {
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));

	return { release, released };
}

// Holds the destination choice open and answers it with Bare Peak once released.
async function holdRandom(page: Page) {
	const gate = deferred();
	const requests: string[] = [];
	await page.route(RANDOM_ENDPOINT, async (route: Route) => {
		requests.push(new URL(route.request().url()).search);
		await gate.released;
		await route.fulfill({
			json: BARE_PEAK_RECORD,
			headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }
		});
	});

	return { release: gate.release, requests };
}

async function pushRoute(page: Page, url: string) {
	await page.evaluate((target) => {
		void (window as NextWindow).next!.router.push(target);
	}, url);
}

async function expectSettledOn(page: Page, mountain: Named, path = `/mountains/${mountain.slug}`) {
	await expect(page).toHaveURL(new RegExp(`${path}$`));
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(mountain.name);
	await expect(exploreButton(page)).toHaveAttribute('aria-busy', 'false');
	await expect(page.locator('header').getByRole('alert')).toHaveCount(0);
}

// Negative evidence needs a settled network, not a sleep: the late answer must have been consumed.
async function expectStaleAnswerConsumed(page: Page) {
	await page.waitForLoadState('networkidle');
}

test.describe('@nogl Explore superseded by navigation', () => {
	test('a link followed while the destination is being chosen wins over the late answer', async ({
		page
	}) => {
		const watched = await watch(page);
		const random = await holdRandom(page);
		await page.goto(`/mountains/${OLYMPUS.slug}`);
		await page.locator('main').evaluate((main) => main.setAttribute('data-probe', 'persistent'));
		const documentsBefore = watched.documents.length;

		await exploreButton(page).click();
		await expect(exploreButton(page)).toHaveAttribute('aria-busy', 'true');
		await page.getByRole('link', { name: /today/i }).click();

		await expectSettledOn(page, DAILY, '');
		random.release();
		await expectStaleAnswerConsumed(page);
		await expectSettledOn(page, DAILY, '');
		await expect(page.locator('main[data-probe="persistent"]')).toHaveCount(1);
		expect(watched.documents.length).toBe(documentsBefore);
		expect(random.requests).toEqual([`?exclude=${OLYMPUS.slug}`]);
		expect(watched.pageErrors).toEqual([]);
	});

	test('a permalink pushed while the destination is being chosen wins and Explore stays usable', async ({
		page
	}) => {
		const watched = await watch(page);
		const random = await holdRandom(page);
		await page.goto(`/mountains/${ACONCAGUA.slug}`);

		await exploreButton(page).click();
		await pushRoute(page, `/mountains/${OLYMPUS.slug}`);
		await expectSettledOn(page, OLYMPUS);
		random.release();
		await expectStaleAnswerConsumed(page);

		await expectSettledOn(page, OLYMPUS);
		await exploreButton(page).click();
		await expectSettledOn(page, BARE_PEAK);
		expect(random.requests).toEqual([`?exclude=${ACONCAGUA.slug}`, `?exclude=${OLYMPUS.slug}`]);
		expect(watched.pageErrors).toEqual([]);
	});

	test('browser Back while the destination is being chosen wins over the late answer', async ({
		page
	}) => {
		const watched = await watch(page);
		const random = await holdRandom(page);
		await page.goto(`/mountains/${ACONCAGUA.slug}`);
		await pushRoute(page, `/mountains/${OLYMPUS.slug}`);
		await expectSettledOn(page, OLYMPUS);

		await exploreButton(page).click();
		await expect(exploreButton(page)).toHaveAttribute('aria-busy', 'true');
		await page.goBack();

		await expectSettledOn(page, ACONCAGUA);
		random.release();
		await expectStaleAnswerConsumed(page);
		await expectSettledOn(page, ACONCAGUA);

		await exploreButton(page).click();
		await expectSettledOn(page, BARE_PEAK);
		expect(watched.pageErrors).toEqual([]);
	});

	test('a navigation that replaces Explore’s own route change while it loads wins', async ({
		page
	}) => {
		const watched = await watch(page);
		const data = deferred();
		await page.goto(`/mountains/${ACONCAGUA.slug}`);
		await page.route(`**/_next/data/**/mountains/${BARE_PEAK.slug}.json*`, async (route) => {
			await data.released;
			await route.continue();
		});

		await exploreButton(page).click();
		await expect(exploreButton(page)).toHaveAttribute('aria-busy', 'true');
		await pushRoute(page, `/mountains/${OLYMPUS.slug}`);

		await expectSettledOn(page, OLYMPUS);
		data.release();
		await expectStaleAnswerConsumed(page);
		await expectSettledOn(page, OLYMPUS);
		expect(watched.pageErrors).toEqual([]);
	});

	test('a navigation to the destination Explore chose leaves one coherent page', async ({
		page
	}) => {
		const watched = await watch(page);
		const random = await holdRandom(page);
		await page.goto(`/mountains/${ACONCAGUA.slug}`);

		await exploreButton(page).click();
		await pushRoute(page, `/mountains/${BARE_PEAK.slug}`);
		await expectSettledOn(page, BARE_PEAK);
		random.release();
		await expectStaleAnswerConsumed(page);

		await expectSettledOn(page, BARE_PEAK);
		await page.goBack();
		await expectSettledOn(page, ACONCAGUA);
		expect(watched.pageErrors).toEqual([]);
	});

	test('does not wait for the destination photograph, which can still be loading', async ({
		page
	}) => {
		const watched = await watch(page);
		const photo = deferred();
		const photoRequests: string[] = [];
		await page.route(/^https:\/\/(upload|thumb)\.wikimedia\.org\//, async (route) => {
			photoRequests.push(route.request().url());
			await photo.released;
			await route.abort('blockedbyclient');
		});
		await page.goto(`/mountains/${BARE_PEAK.slug}`);

		await exploreButton(page).click();

		await expectSettledOn(page, ACONCAGUA);
		await expect.poll(() => photoRequests.length).toBeGreaterThan(0);
		photo.release();
		expect(watched.pageErrors).toEqual([]);
	});
});
