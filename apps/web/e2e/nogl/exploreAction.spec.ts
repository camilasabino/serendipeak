import { expect, test, type Locator, type Page } from '@playwright/test';
import { fixture, resetStub, useScenario } from '../ssr/support';

interface Named {
	slug: string;
	name: string;
}

const ACONCAGUA = fixture<Named>('mountain-complete.json');
const PERMALINK = `/mountains/${ACONCAGUA.slug}`;
const RANDOM_ENDPOINT = '**/api/v1/mountains/random**';

const explore = (page: Page) => page.getByRole('button', { name: /^Explore another|^Exploring/ });

async function box(locator: Locator) {
	const result = await locator.boundingBox();
	expect(result).not.toBeNull();
	return result!;
}

async function holdRandom(page: Page) {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	await page.route(RANDOM_ENDPOINT, async (route) => {
		await gate;
		await route.continue();
	});

	return release;
}

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('@nogl Explore another in the sheet', () => {
	test('is the full-width primary action between the lede and the facts', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto(PERMALINK);

		const button = await box(explore(page));
		const sheetSection = await box(page.locator('main section').first());
		const lede = await box(page.locator('main section p').last());
		const facts = await box(page.locator('main section dl'));

		expect(button.width).toBeCloseTo(sheetSection.width, 0);
		expect(button.height).toBeGreaterThanOrEqual(56);
		expect(button.y).toBeGreaterThanOrEqual(lede.y + lede.height);
		expect(button.y + button.height).toBeLessThanOrEqual(facts.y);
		await expect(explore(page)).toHaveCSS('border-radius', '999px');
	});

	test('uses the copper action colours, with a dark disc around the arrow', async ({ page }) => {
		await page.goto(PERMALINK);

		const colours = await explore(page).evaluate((button) => {
			const disc = button.querySelector('span[aria-hidden="true"]')!;
			return {
				background: getComputedStyle(button).backgroundColor,
				label: getComputedStyle(button).color,
				disc: getComputedStyle(disc).backgroundColor,
				arrow: getComputedStyle(disc).color,
				font: getComputedStyle(button).fontSize
			};
		});

		expect(colours).toEqual({
			background: 'rgb(209, 138, 85)',
			label: 'rgb(20, 12, 7)',
			disc: 'rgb(17, 15, 14)',
			arrow: 'rgb(223, 154, 102)',
			font: '18px'
		});
	});

	test('lightens on hover and moves the arrow disc 0.25 rem', async ({ page }) => {
		await page.goto(PERMALINK);
		const disc = explore(page).locator('span[aria-hidden="true"]');

		await explore(page).hover();

		await expect(explore(page)).toHaveCSS('background-color', 'rgb(227, 161, 113)');
		await expect
			.poll(() =>
				disc.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m41)
			)
			.toBe(-4);
	});

	test('keeps the arrow still under reduced motion', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto(PERMALINK);

		await explore(page).hover();

		await expect(explore(page)).toHaveCSS('background-color', 'rgb(227, 161, 113)');
		await expect(explore(page).locator('span[aria-hidden="true"]')).toHaveCSS('transform', 'none');
		await expect(explore(page)).toHaveCSS('transition-duration', '0s');
	});

	test('shows a copper focus ring on keyboard focus', async ({ page }) => {
		await page.goto(PERMALINK);

		for (let presses = 0; presses < 30; presses += 1) {
			await page.keyboard.press('Tab');
			if (await explore(page).evaluate((element) => element === document.activeElement)) break;
		}

		await expect(explore(page)).toBeFocused();
		const ring = await explore(page).evaluate((button) => {
			const style = getComputedStyle(button);
			return { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor };
		});
		expect(ring).toEqual({ style: 'solid', width: '2px', color: 'rgb(223, 154, 102)' });
	});

	test('shows its busy state, keeps its size and its sweep stops under reduced motion', async ({
		page
	}) => {
		const release = await holdRandom(page);
		await page.goto(PERMALINK);
		const before = await box(explore(page));

		await explore(page).click();

		await expect(explore(page)).toHaveAttribute('aria-busy', 'true');
		await expect(explore(page)).toHaveCSS('cursor', 'progress');
		await expect(explore(page)).toHaveCSS('background-color', 'rgb(209, 138, 85)');
		const sweep = await explore(page).evaluate((button) => {
			const style = getComputedStyle(button, '::after');
			return { animation: style.animationName, content: style.content };
		});
		expect(sweep.animation).not.toBe('none');
		expect(sweep.content).toBe('""');
		expect(await box(explore(page))).toEqual(before);
		release();
		await expect(page).toHaveURL(/\/mountains\/(?!aconcagua)/);
	});

	test('replaces the sweep with a still line under reduced motion', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		const release = await holdRandom(page);
		await page.goto(PERMALINK);

		await explore(page).click();

		await expect(explore(page)).toHaveAttribute('aria-busy', 'true');
		await expect(async () => {
			const animation = await explore(page).evaluate(
				(button) => getComputedStyle(button, '::after').animationName
			);
			expect(animation).toBe('none');
		}).toPass();
		release();
	});

	test('shows a failure under the button with an icon, without moving the button', async ({
		page,
		request
	}) => {
		await page.goto(PERMALINK);
		const before = await box(explore(page));
		await useScenario(request, 'server-error');

		await explore(page).click();

		const alert = page.locator('main section').getByRole('alert');
		await expect(alert).toHaveText('Another mountain could not be loaded. Try again.');
		await expect(alert.locator('svg[aria-hidden="true"]')).toHaveCount(1);
		const placed = await box(alert);
		expect(placed.y).toBeGreaterThanOrEqual(before.y + before.height);
		expect(await box(explore(page))).toEqual(before);
		await expect(explore(page)).toHaveAttribute('aria-busy', 'false');
	});

	for (const [width, height] of [
		[1440, 900],
		[1280, 800],
		[1280, 720]
	] as const) {
		test(`is fully visible above the fold for a one-line name at ${width}×${height}`, async ({
			page
		}) => {
			await page.setViewportSize({ width, height });
			await page.goto(PERMALINK);

			const button = await box(explore(page));

			expect(button.y).toBeGreaterThanOrEqual(0);
			expect(button.y + button.height).toBeLessThanOrEqual(height);
			await expect(explore(page)).toBeInViewport({ ratio: 1 });
		});
	}

	for (const [width, height] of [
		[960, 540],
		[390, 844],
		[375, 667],
		[320, 568]
	] as const) {
		test(`is reachable by scrolling, uncovered and within the viewport width at ${width}×${height}`, async ({
			page
		}) => {
			await page.setViewportSize({ width, height });
			await page.goto(PERMALINK);

			await explore(page).scrollIntoViewIfNeeded();

			await expect(explore(page)).toBeInViewport({ ratio: 1 });
			const button = await box(explore(page));
			expect(button.x).toBeGreaterThanOrEqual(0);
			expect(button.x + button.width).toBeLessThanOrEqual(width);
			const covered = await explore(page).evaluate((element) => {
				const rect = element.getBoundingClientRect();
				const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
				return top !== null && !element.contains(top);
			});
			expect(covered).toBe(false);
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
			expect(overflow).toBeLessThanOrEqual(0);
		});
	}
});
