import { expect, test, type Locator, type Page } from '@playwright/test';
import { fixture, resetStub, serveMountain } from '../ssr/support';

const COMPLETE = fixture<Record<string, unknown> & { slug: string; name: string; summary: string }>(
	'mountain-complete.json'
);

const WORDS_PER_PARAGRAPH = 50;
const PARAGRAPHS = 7;
const UNBREAKABLE = `https://example.org/${'long-path-segment/'.repeat(8)}`;

// Seven paragraphs of fifty words: exactly the limit of 350, with one word that has no break point.
const DESCRIPTION = Array.from({ length: PARAGRAPHS }, (_, paragraph) =>
	Array.from({ length: WORDS_PER_PARAGRAPH }, (_, word) =>
		paragraph === 0 && word === 10 ? UNBREAKABLE : `word${paragraph}x${word}`
	).join(' ')
).join('\n\n');

const DESCRIBED = {
	...COMPLETE,
	slug: 'described-peak',
	name: 'Described Peak',
	description: DESCRIPTION
};
const PATH = `/mountains/${DESCRIBED.slug}`;

const photograph = (page: Page) => page.locator('figure').first();
const summary = (page: Page) => page.getByText(DESCRIBED.summary, { exact: true });
const facts = (page: Page) => page.locator('dl');
const firstParagraph = (page: Page) => page.getByText(/^word0x0 /);
const lastParagraph = (page: Page) => page.getByText(/^word6x0 /);
const explore = (page: Page) => page.getByRole('button', { name: /^Explore another/ });
const toggle = (page: Page, name: 'Read more' | 'Show less') =>
	page.getByRole('button', { name, exact: true });
const attribution = (page: Page) => page.getByText('About this photo');

async function top(locator: Locator) {
	const box = await locator.boundingBox();
	expect(box).not.toBeNull();
	return box!.y;
}

async function expectInOrder(...locators: Locator[]) {
	const tops = [];
	for (const locator of locators) {
		tops.push(await top(locator));
	}
	expect(tops).toEqual([...tops].sort((a, b) => a - b));
	expect(new Set(tops).size).toBe(tops.length);
}

test.beforeEach(async ({ request }) => {
	await resetStub(request);
	await serveMountain(request, DESCRIBED);
});

test.describe('@nogl mountain description', () => {
	test('reads summary, photograph, facts, description and Explore on a phone', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(PATH);
		await toggle(page, 'Read more').click();

		await expectInOrder(
			summary(page),
			photograph(page),
			facts(page),
			firstParagraph(page),
			lastParagraph(page),
			explore(page)
		);
		await expect(attribution(page)).toBeVisible();
	});

	test('reads photograph, summary, facts, description and Explore on desktop', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(PATH);
		await toggle(page, 'Read more').click();

		await expectInOrder(
			photograph(page),
			summary(page),
			facts(page),
			firstParagraph(page),
			lastParagraph(page),
			explore(page)
		);
	});

	test('keeps the summary larger than the description', async ({ page }) => {
		await page.goto(PATH);

		const size = (locator: Locator) =>
			locator.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));

		expect(await size(summary(page))).toBeGreaterThan(await size(firstParagraph(page)));
	});

	test('scrolls the desktop sheet on its own and never the page', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(PATH);
		await toggle(page, 'Read more').click();

		const sheet = await lastParagraph(page).evaluate((element) => {
			let scroller: Element | null = element;
			while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
				scroller = scroller.parentElement;
			}
			return scroller
				? { scrollable: scroller.scrollHeight > scroller.clientHeight, found: true }
				: { scrollable: false, found: false };
		});
		expect(sheet).toEqual({ found: true, scrollable: true });

		await explore(page).scrollIntoViewIfNeeded();
		expect(await page.evaluate(() => scrollY)).toBe(0);
		await expect(explore(page)).toBeInViewport();
	});

	test('scrolls the phone page naturally down to Explore', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(PATH);
		await toggle(page, 'Read more').click();

		await explore(page).scrollIntoViewIfNeeded();

		expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
		await expect(explore(page)).toBeInViewport();
	});

	for (const [width, height] of [
		[320, 640],
		[390, 844],
		[768, 1024],
		[1440, 900]
	] as const) {
		test(`has no horizontal overflow with 350 words at ${width}×${height}`, async ({ page }) => {
			await page.setViewportSize({ width, height });
			await page.goto(PATH);
			await toggle(page, 'Read more').click();

			expect(
				await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
			).toBeLessThanOrEqual(0);

			const paragraphs = page.locator('section p', { hasText: /^word\d/ });
			expect(await paragraphs.count()).toBe(PARAGRAPHS);
			for (let index = 0; index < PARAGRAPHS; index++) {
				const overflow = await paragraphs
					.nth(index)
					.evaluate((element) => element.scrollWidth - element.clientWidth);
				expect(overflow, `paragraph ${index}`).toBeLessThanOrEqual(0);
			}
		});
	}

	test('shows the first paragraph and Read more, with Explore below, until expanded', async ({
		page
	}) => {
		await page.goto(PATH);

		await expect(firstParagraph(page)).toBeVisible();
		await expect(lastParagraph(page)).toBeHidden();
		await expect(toggle(page, 'Read more')).toHaveAttribute('aria-expanded', 'false');
		await expectInOrder(firstParagraph(page), toggle(page, 'Read more'), explore(page));
	});

	test('expands every paragraph and collapses back with the keyboard, keeping focus', async ({
		page
	}) => {
		await page.goto(PATH);

		await toggle(page, 'Read more').focus();
		await page.keyboard.press('Enter');

		await expect(lastParagraph(page)).toBeVisible();
		await expect(toggle(page, 'Show less')).toBeFocused();
		await expect(toggle(page, 'Show less')).toHaveAttribute('aria-expanded', 'true');
		await expectInOrder(lastParagraph(page), toggle(page, 'Show less'), explore(page));

		await page.keyboard.press('Space');

		await expect(lastParagraph(page)).toBeHidden();
		await expect(toggle(page, 'Read more')).toBeFocused();
		await expect(toggle(page, 'Read more')).toBeInViewport();
		await expect(firstParagraph(page)).toBeVisible();
	});

	test('keeps the control in view after collapsing on a phone', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(PATH);
		await toggle(page, 'Read more').click();
		await toggle(page, 'Show less').scrollIntoViewIfNeeded();
		await toggle(page, 'Show less').click();

		await expect(toggle(page, 'Read more')).toBeInViewport();
		expect((await toggle(page, 'Read more').boundingBox())!.height).toBeGreaterThanOrEqual(44);
	});

	test('starts collapsed again on another mountain', async ({ page, request }) => {
		const other = { ...DESCRIBED, slug: 'other-peak', name: 'Other Peak' };
		await serveMountain(request, other);
		await page.goto(PATH);
		await toggle(page, 'Read more').click();
		await expect(lastParagraph(page)).toBeVisible();

		await page.goto(`/mountains/${other.slug}`);

		await expect(toggle(page, 'Read more')).toHaveAttribute('aria-expanded', 'false');
		await expect(lastParagraph(page)).toBeHidden();
	});

	for (const [width, height] of [
		[390, 844],
		[1440, 900]
	] as const) {
		test(`lets the summary fill its container at ${width}×${height}`, async ({ page }) => {
			await page.setViewportSize({ width, height });
			await page.goto(PATH);

			expect(await summary(page).evaluate((element) => getComputedStyle(element).maxWidth)).toBe(
				'none'
			);
			const [summaryWidth, parentWidth] = await summary(page).evaluate((element) => {
				const parent = element.parentElement!;
				const style = getComputedStyle(parent);
				return [
					element.getBoundingClientRect().width,
					parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
				];
			});
			expect(summaryWidth).toBeCloseTo(parentWidth, 0);
		});
	}
});
