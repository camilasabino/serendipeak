import { expect, test, type Page } from '@playwright/test';
import { fixture, resetStub } from '../ssr/support';

interface Named {
	slug: string;
	name: string;
}

const ACONCAGUA = fixture<Named>('mountain-complete.json');
const DAILY = fixture<{ mountain: Named }>('daily-mountain.json').mountain;

function isLocal(url: URL): boolean {
	return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
}

async function watch(page: Page) {
	const requests: URL[] = [];
	const pageErrors: string[] = [];

	page.on('pageerror', (error) => pageErrors.push(error.message));
	page.on('request', (request) => requests.push(new URL(request.url())));
	await page.route(
		(url) => !isLocal(url),
		(route) => route.abort('blockedbyclient')
	);

	return { requests, pageErrors };
}

const aboutLink = (page: Page) =>
	page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'About' });

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('@nogl About page', () => {
	test('is reached from the daily page by client navigation and leads back to it', async ({
		page
	}) => {
		const watched = await watch(page);
		await page.goto('/');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(DAILY.name);
		await page.locator('body').evaluate((body) => body.setAttribute('data-probe', 'persistent'));

		await aboutLink(page).click();

		await expect(page).toHaveURL(/\/about$/);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			'Discover one mountain every day.'
		);
		await expect(page).toHaveTitle('About · SerendiPeak');
		await expect(aboutLink(page)).toHaveAttribute('aria-current', 'page');
		await expect(page.locator('body[data-probe="persistent"]')).toHaveCount(1);

		await page.getByRole('link', { name: "See today's mountain" }).click();

		await expect(page).toHaveURL(/\/$/);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(DAILY.name);
		await expect(aboutLink(page)).not.toHaveAttribute('aria-current', /.*/);
		expect(watched.pageErrors).toEqual([]);
	});

	test('is reached from a permalink and from the brand link home', async ({ page }) => {
		await watch(page);
		await page.goto(`/mountains/${ACONCAGUA.slug}`);

		await aboutLink(page).click();
		await expect(page).toHaveURL(/\/about$/);

		await page.getByRole('link', { name: 'SerendiPeak' }).first().click();
		await expect(page).toHaveURL(/\/$/);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(DAILY.name);
	});

	test('is operable by keyboard from the header', async ({ page }) => {
		await watch(page);
		await page.goto('/');

		await aboutLink(page).focus();
		await expect(aboutLink(page)).toBeFocused();
		await page.keyboard.press('Enter');

		await expect(page).toHaveURL(/\/about$/);
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	});

	test('exposes landmarks, ordered headings and a labelled vision section', async ({ page }) => {
		await watch(page);
		await page.goto('/about');

		await expect(page.getByRole('banner')).toHaveCount(1);
		await expect(page.getByRole('main')).toHaveCount(1);
		await expect(page.getByRole('contentinfo')).toHaveCount(1);
		await expect(page.getByRole('heading', { level: 2 })).toHaveText([
			'What you can do today',
			'Why it matters',
			'Where it could go'
		]);
		await expect(page.getByRole('region', { name: 'Where it could go' })).toContainText(
			'Possibilities, not available today'
		);
	});

	test('never loads or initializes the 3D stage', async ({ page }) => {
		const watched = await watch(page);
		await page.goto('/about');
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		await page.waitForLoadState('networkidle');

		expect(watched.requests.filter((url) => /cesium/i.test(url.href))).toEqual([]);
		expect(watched.requests.filter((url) => !isLocal(url))).toEqual([]);
		await expect(page.locator('canvas, [data-stage], .cesium-viewer')).toHaveCount(0);
		expect(watched.pageErrors).toEqual([]);
	});

	test('scrolls with the window on desktop and keeps the footer reachable', async ({ page }) => {
		await watch(page);
		await page.setViewportSize({ width: 1280, height: 640 });
		await page.goto('/about');

		await page.mouse.wheel(0, 4000);

		await expect(page.getByRole('contentinfo')).toBeInViewport();
		expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
		await expect(page.getByRole('banner')).toBeInViewport();
	});
});

test.describe('@nogl About page responsiveness', () => {
	for (const viewport of [
		{ width: 320, height: 640 },
		{ width: 390, height: 844 },
		{ width: 820, height: 1024 },
		{ width: 1280, height: 800 }
	]) {
		test(`has no horizontal overflow at ${viewport.width}px`, async ({ page }) => {
			await watch(page);
			await page.setViewportSize(viewport);
			await page.goto('/about');
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
			expect(overflow).toBeLessThanOrEqual(0);
		});
	}

	// The wordmark gives way to the controls on a mountain page below 428px.
	for (const width of [320, 360, 375, 390, 430]) {
		test(`keeps the header controls apart and tappable at ${width}px`, async ({ page }) => {
			await watch(page);
			await page.setViewportSize({ width, height: 740 });
			await page.goto(`/mountains/${ACONCAGUA.slug}`);
			await expect(page.getByRole('link', { name: 'SerendiPeak' }).first()).toBeVisible();

			// Measure the wordmark's text, not its link: the link box shrinks while the text overflows.
			const extents = await page.evaluate(() => {
				const header = document.querySelector('header')!;
				const edges = (rect: DOMRect) => ({ left: rect.left, right: rect.right });
				const wordmark = header.querySelector('a span')!;
				const text = document.createRange();
				text.selectNodeContents(wordmark);
				const [search, explore] = [...header.querySelectorAll('nav button')];
				const about = header.querySelector('nav a')!.getBoundingClientRect();
				const searchBox = search!.getBoundingClientRect();

				return {
					brandText:
						wordmark.getBoundingClientRect().width > 1 ? edges(text.getBoundingClientRect()) : null,
					brandLink: edges(header.querySelector('a')!.getBoundingClientRect()),
					search: { ...edges(searchBox), width: searchBox.width, height: searchBox.height },
					about: { ...edges(about), height: about.height },
					explore: edges(explore!.getBoundingClientRect())
				};
			});

			expect(extents.brandText === null).toBe(width < 428);
			expect(extents.about.height).toBeGreaterThanOrEqual(44);
			expect(extents.search.height).toBeGreaterThanOrEqual(44);
			expect(extents.search.width).toBeGreaterThanOrEqual(44);
			expect(extents.brandLink.right).toBeLessThanOrEqual(extents.search.left);
			if (extents.brandText) {
				expect(extents.brandText.right).toBeLessThanOrEqual(extents.search.left);
			}
			expect(extents.search.right).toBeLessThanOrEqual(extents.about.left);
			expect(extents.about.right).toBeLessThanOrEqual(extents.explore.left);
			expect(extents.explore.right).toBeLessThanOrEqual(width);
		});
	}

	for (const width of [360, 390]) {
		test(`keeps the wordmark beside search and About at ${width}px`, async ({ page }) => {
			await watch(page);
			await page.setViewportSize({ width, height: 740 });
			await page.goto('/about');

			const [wordmarkRight, searchLeft] = await page.evaluate(() => {
				const header = document.querySelector('header')!;
				const text = document.createRange();
				text.selectNodeContents(header.querySelector('a span')!);
				return [
					text.getBoundingClientRect().right,
					header.querySelector('nav button')!.getBoundingClientRect().left
				];
			});

			expect(wordmarkRight).toBeGreaterThan(0);
			expect(wordmarkRight).toBeLessThanOrEqual(searchLeft);
		});
	}

	test('keeps the brand link named when the wordmark is hidden on a very narrow screen', async ({
		page
	}) => {
		await watch(page);
		await page.setViewportSize({ width: 320, height: 640 });
		await page.goto('/about');

		await expect(page.getByRole('link', { name: 'SerendiPeak' }).first()).toHaveAttribute(
			'href',
			'/'
		);
	});
});
