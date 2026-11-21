import { expect, test, type Locator, type Page } from '@playwright/test';
import { SITE_ORIGIN } from '../support/ports';
import { fixture, resetStub } from '../ssr/support';

interface Named {
	slug: string;
	name: string;
}

const ACONCAGUA = fixture<Named>('mountain-complete.json');
const DAILY = fixture<{ mountain: Named }>('daily-mountain.json').mountain;
const PERMALINK = `/mountains/${ACONCAGUA.slug}`;
const CANONICAL = `${SITE_ORIGIN}${PERMALINK}`;

const WIDTHS = [320, 375, 390, 768, 960, 1024, 1280, 1440];

const copyButton = (page: Page) => page.getByRole('button', { name: 'Copy link' });
const shareButton = (page: Page) => page.getByRole('button', { name: `Share ${ACONCAGUA.name}` });
const fallback = (page: Page) => page.getByRole('group', { name: /Couldn't copy the link/ });
const fallbackField = (page: Page) =>
	page.getByRole('textbox', { name: `Link to ${ACONCAGUA.name}` });
const liveRegion = (page: Page) => page.locator('main [aria-live="polite"]');

type ShareWindow = Window & { __shared?: { title: string; url: string }[] };

async function refuseClipboard(page: Page) {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				writeText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError'))
			}
		});
	});
}

async function removeClipboard(page: Page) {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
	});
}

async function offerNativeShare(page: Page, behaviour: 'resolve' | 'cancel' | 'refuse') {
	await page.addInitScript((mode) => {
		(window as ShareWindow).__shared = [];
		Object.defineProperty(navigator, 'share', {
			configurable: true,
			value: (data: { title: string; url: string }) => {
				(window as ShareWindow).__shared?.push(data);
				if (mode === 'cancel') return Promise.reject(new DOMException('Cancelled', 'AbortError'));
				if (mode === 'refuse')
					return Promise.reject(new DOMException('Refused', 'NotAllowedError'));
				return Promise.resolve();
			}
		});
	}, behaviour);
}

async function box(locator: Locator) {
	const result = await locator.boundingBox();
	expect(result).not.toBeNull();
	return result!;
}

async function tabTo(page: Page, target: Locator) {
	for (let presses = 0; presses < 30; presses += 1) {
		await page.keyboard.press('Tab');
		if (await target.evaluate((element) => element === document.activeElement)) return;
	}
	throw new Error('The target never received keyboard focus');
}

async function clipboardText(page: Page): Promise<string> {
	return page.evaluate(() => navigator.clipboard.readText());
}

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('@nogl Share and Copy link', () => {
	test('sit in the running head as two named, 44 px buttons with distinct glyphs', async ({
		page
	}) => {
		await offerNativeShare(page, 'resolve');
		await page.goto(PERMALINK);

		const group = page.getByRole('group', { name: 'Share', exact: true });
		await expect(group.getByRole('button')).toHaveCount(2);
		await expect(shareButton(page)).toBeVisible();
		await expect(copyButton(page)).toBeVisible();

		for (const button of [shareButton(page), copyButton(page)]) {
			const size = await box(button);
			expect(size.width).toBeGreaterThanOrEqual(44);
			expect(size.height).toBeGreaterThanOrEqual(44);
		}
		const glyphs = await group
			.getByRole('button')
			.evaluateAll((buttons) => buttons.map((button) => button.querySelector('svg')?.innerHTML));
		expect(glyphs[0]).toBeTruthy();
		expect(glyphs[0]).not.toBe(glyphs[1]);

		const head = await box(group.locator('..'));
		const share = await box(group);
		expect(share.y).toBeGreaterThanOrEqual(head.y);
		expect(share.y + share.height).toBeLessThanOrEqual(head.y + head.height);
	});

	test('draws a boundary the control needs and a tooltip that appears on keyboard focus', async ({
		page
	}) => {
		await page.goto(PERMALINK);

		const border = await copyButton(page).evaluate((button) => {
			const style = getComputedStyle(button);
			return {
				width: style.borderTopWidth,
				color: style.borderTopColor,
				radius: style.borderRadius
			};
		});
		expect(border.width).toBe('1px');
		expect(border.radius).toBe('50%');
		expect(border.color).not.toBe('rgba(0, 0, 0, 0)');

		const tip = copyButton(page).locator('span[aria-hidden="true"]');
		await expect(tip).toHaveCSS('opacity', '0');
		await tabTo(page, copyButton(page));
		await expect(copyButton(page)).toBeFocused();
		await expect(tip).toHaveCSS('opacity', '1');
		await expect(tip).toHaveText('Copy link');
	});

	test('copies the canonical link, confirms it in a live region and moves nothing', async ({
		page,
		context
	}) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await page.goto(PERMALINK);
		const name = page.getByRole('heading', { level: 1 });
		const before = { name: await box(name), button: await box(copyButton(page)) };
		await expect(liveRegion(page)).toHaveText('');

		await copyButton(page).click();

		await expect(liveRegion(page)).toHaveText('Link copied.');
		expect(await clipboardText(page)).toBe(CANONICAL);
		await expect(copyButton(page)).toHaveAttribute('data-done', 'true');
		await expect(copyButton(page)).toHaveAccessibleName('Copy link');
		await expect(copyButton(page).locator('span[aria-hidden="true"]')).toHaveText('Link copied.');
		expect({ name: await box(name), button: await box(copyButton(page)) }).toEqual(before);
		await expect(fallback(page)).toHaveCount(0);
	});

	test('copies from the keyboard and clears its confirmation on its own', async ({
		page,
		context
	}) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await page.goto(PERMALINK);

		await copyButton(page).focus();
		await page.keyboard.press('Enter');
		await expect(liveRegion(page)).toHaveText('Link copied.');
		await expect(copyButton(page)).toBeFocused();

		await expect(liveRegion(page)).toHaveText('', { timeout: 8000 });
		await expect(copyButton(page)).not.toHaveAttribute('data-done', 'true');

		await page.keyboard.press('Space');
		await expect(liveRegion(page)).toHaveText('Link copied.');
	});

	test('copies the permanent link of today’s mountain from the daily page', async ({
		page,
		context
	}) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await page.goto('/');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(DAILY.name);

		await copyButton(page).click();

		await expect(liveRegion(page)).toHaveText('Link copied.');
		expect(await clipboardText(page)).toBe(`${SITE_ORIGIN}/mountains/${DAILY.slug}`);
	});

	test('offers the link in a focused, read-only field when the clipboard refuses', async ({
		page
	}) => {
		await refuseClipboard(page);
		await page.goto(PERMALINK);
		const name = page.getByRole('heading', { level: 1 });
		const before = await box(name);

		await copyButton(page).click();

		await expect(fallback(page)).toBeVisible();
		await expect(fallbackField(page)).toHaveValue(CANONICAL);
		await expect(fallbackField(page)).toHaveAttribute('readonly', '');
		await expect(fallbackField(page)).toBeFocused();
		expect(
			await fallbackField(page).evaluate((field: HTMLInputElement) => field.selectionEnd)
		).toBe(CANONICAL.length);
		await expect(copyButton(page)).not.toHaveAttribute('data-done', 'true');
		expect(await box(name)).toEqual(before);
	});

	test('treats a missing clipboard like a refusal', async ({ page }) => {
		await removeClipboard(page);
		await page.goto(PERMALINK);

		await copyButton(page).click();

		await expect(fallbackField(page)).toHaveValue(CANONICAL);
		await expect(fallbackField(page)).toBeFocused();
	});

	test('closes the fallback with Escape and returns focus to Copy link', async ({ page }) => {
		await refuseClipboard(page);
		await page.goto(PERMALINK);
		await copyButton(page).click();
		await expect(fallbackField(page)).toBeFocused();

		await page.keyboard.press('Escape');

		await expect(fallback(page)).toHaveCount(0);
		await expect(copyButton(page)).toBeFocused();
	});

	test('closes the fallback on a click outside without taking focus from what was clicked', async ({
		page
	}) => {
		await refuseClipboard(page);
		await page.goto(PERMALINK);
		await copyButton(page).click();
		await expect(fallback(page)).toBeVisible();

		await page.getByRole('button', { name: /^Explore another/ }).focus();
		await expect(fallback(page)).toHaveCount(0);

		await copyButton(page).click();
		await expect(fallback(page)).toBeVisible();
		const search = page.getByRole('button', { name: 'Search mountains' });
		await search.click();

		await expect(fallback(page)).toHaveCount(0);
		await expect(page.getByRole('dialog', { name: 'Search mountains' })).toBeVisible();
	});

	test('closes the fallback on a click on plain content', async ({ page }) => {
		await refuseClipboard(page);
		await page.goto(PERMALINK);
		await copyButton(page).click();
		await expect(fallback(page)).toBeVisible();

		await page.getByRole('heading', { level: 1 }).click({ position: { x: 4, y: 4 } });

		await expect(fallback(page)).toHaveCount(0);
	});

	test('closes the fallback when focus tabs out of it and never traps it', async ({ page }) => {
		await refuseClipboard(page);
		await page.goto(PERMALINK);
		await copyButton(page).click();
		await expect(fallbackField(page)).toBeFocused();

		await page.keyboard.press('Tab');

		await expect(fallback(page)).toHaveCount(0);
		const focusedOutside = await page.evaluate(
			() =>
				document.activeElement !== document.body &&
				!document.activeElement?.closest('[role="group"]')
		);
		expect(focusedOutside).toBe(true);
	});

	test('keeps the fallback open while focus moves back to Copy link', async ({ page }) => {
		await refuseClipboard(page);
		await page.goto(PERMALINK);
		await copyButton(page).click();
		await expect(fallbackField(page)).toBeFocused();

		await page.keyboard.press('Shift+Tab');
		await expect(copyButton(page)).toBeFocused();
		await expect(fallback(page)).toBeVisible();

		await page.keyboard.press('Enter');
		await expect(fallbackField(page)).toBeFocused();
		await expect(fallback(page)).toBeVisible();
	});

	test('leaves the live region to successes, since focus reaches the field for a failure', async ({
		page
	}) => {
		await refuseClipboard(page);
		await page.goto(PERMALINK);

		await copyButton(page).click();

		await expect(fallbackField(page)).toBeFocused();
		await expect(liveRegion(page)).toHaveText('');
	});

	test.describe('with native sharing', () => {
		test('shares the title and canonical link and confirms it', async ({ page }) => {
			await offerNativeShare(page, 'resolve');
			await page.goto(PERMALINK);

			await shareButton(page).click();

			await expect(liveRegion(page)).toHaveText('Link shared.');
			await expect(shareButton(page)).toHaveAttribute('data-done', 'true');
			await expect(copyButton(page)).not.toHaveAttribute('data-done', 'true');
			expect(await page.evaluate(() => (window as ShareWindow).__shared)).toEqual([
				{ title: ACONCAGUA.name, url: CANONICAL }
			]);
			await expect(fallback(page)).toHaveCount(0);
		});

		test('treats cancelling the sheet as a choice, not an error', async ({ page }) => {
			await offerNativeShare(page, 'cancel');
			await page.goto(PERMALINK);

			await shareButton(page).click();

			await expect
				.poll(() => page.evaluate(() => (window as ShareWindow).__shared?.length))
				.toBe(1);
			await expect(liveRegion(page)).toHaveText('');
			await expect(fallback(page)).toHaveCount(0);
			await expect(page.locator('main section').getByRole('alert')).toHaveCount(0);
			await expect(shareButton(page)).not.toHaveAttribute('data-done', 'true');
			await expect(shareButton(page)).toBeEnabled();
		});

		test('falls back to the clipboard when the sheet refuses', async ({ page, context }) => {
			await offerNativeShare(page, 'refuse');
			await context.grantPermissions(['clipboard-read', 'clipboard-write']);
			await page.goto(PERMALINK);

			await shareButton(page).click();
			await expect(liveRegion(page)).toHaveText('Link copied.');
			await expect(copyButton(page)).toHaveAttribute('data-done', 'true');
			expect(await clipboardText(page)).toBe(CANONICAL);
		});

		test('shows the field when neither the sheet nor the clipboard works', async ({ page }) => {
			await offerNativeShare(page, 'refuse');
			await refuseClipboard(page);
			await page.goto(PERMALINK);

			await shareButton(page).click();

			await expect(fallbackField(page)).toHaveValue(CANONICAL);
			await page.keyboard.press('Escape');
			await expect(copyButton(page)).toBeFocused();
		});
	});

	for (const width of WIDTHS) {
		test(`stays inside the sheet, 44 px tall and unclipped at ${width}px`, async ({ page }) => {
			await page.setViewportSize({ width, height: 800 });
			await offerNativeShare(page, 'resolve');
			await refuseClipboard(page);
			await page.goto(PERMALINK);

			const group = page.getByRole('group', { name: 'Share', exact: true });
			// Below 896 px the sheet is display: contents and its parts are rows of the page grid.
			const sheet = await box(
				width < 896 ? page.locator('main') : page.locator('main section').first().locator('..')
			);
			const placed = await box(group);
			expect(placed.x).toBeGreaterThanOrEqual(sheet.x);
			expect(placed.x + placed.width).toBeLessThanOrEqual(sheet.x + sheet.width + 0.5);
			expect(placed.height).toBeGreaterThanOrEqual(44);

			await copyButton(page).click();
			const popover = await box(fallback(page));
			expect(popover.x).toBeGreaterThanOrEqual(sheet.x);
			expect(popover.x + popover.width).toBeLessThanOrEqual(sheet.x + sheet.width + 0.5);
			expect(popover.y).toBeGreaterThanOrEqual(placed.y + placed.height);
			expect(popover.x + popover.width).toBeLessThanOrEqual(width);
			expect((await box(fallbackField(page))).height).toBeGreaterThanOrEqual(44);

			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
			expect(overflow).toBeLessThanOrEqual(0);
		});
	}

	test('moves no control when feedback is shown at 320px', async ({ page, context }) => {
		await page.setViewportSize({ width: 320, height: 640 });
		await offerNativeShare(page, 'resolve');
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await page.goto(PERMALINK);
		const targets = [
			shareButton(page),
			copyButton(page),
			page.getByRole('button', { name: /^Explore another/ })
		];
		const before = await Promise.all(targets.map(box));

		await copyButton(page).click();
		await expect(liveRegion(page)).toHaveText('Link copied.');

		expect(await Promise.all(targets.map(box))).toEqual(before);
	});

	test('stops animating its transitions under reduced motion', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto(PERMALINK);

		const durations = await copyButton(page).evaluate((button) => {
			const style = getComputedStyle(button);
			const tip = getComputedStyle(button.querySelector('span')!);
			return [style.transitionDuration, tip.transitionDuration];
		});

		expect(durations).toEqual(['0s', '0s']);
	});
});
