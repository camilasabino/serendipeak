import type { Page } from '@playwright/test';
import { resetStub, useScenario } from '../ssr/support';
import { chooseCountry, list, openFilters } from './support/atlasList';
import {
	DESKTOP,
	atlasLayer,
	cameraAtRest,
	expect,
	expectReadyStage,
	framesPass,
	globePosition,
	liveViewers,
	OLYMPUS,
	test,
	type AtlasLayerReading
} from './support/stage';

const hide = (page: Page) => page.getByRole('button', { name: 'Hide mountain markers' });
const show = (page: Page) => page.getByRole('button', { name: 'Show mountain markers' });
const chooser = (page: Page) => page.getByRole('dialog', { name: 'Which mountain?' });
const canvas = (page: Page) => page.locator('main canvas');

async function layer(page: Page): Promise<AtlasLayerReading> {
	const reading = await atlasLayer(page);
	expect(reading).toBeDefined();
	return reading!;
}

const continent = (page: Page, name: string) =>
	list(page)
		.locator('summary, button')
		.filter({ hasText: new RegExp(`^${name}`) });

// What the layer holds, in sight or not, against what is actually in view: hiding keeps the former
// and empties the latter.
const held = async (page: Page) =>
	((await atlasLayer(page))?.markers ?? []).map(({ slug }) => slug).sort();
const seen = async (page: Page) =>
	((await atlasLayer(page))?.markers ?? [])
		.filter(({ visible }) => visible)
		.map(({ slug }) => slug)
		.sort();

async function expectCameraUnmoved(page: Page, before: Awaited<ReturnType<typeof globePosition>>) {
	await framesPass(page, 6);
	const after = await globePosition(page);
	expect(after?.longitude).toBeCloseTo(before!.longitude, 6);
	expect(after?.latitude).toBeCloseTo(before!.latitude, 6);
	expect(after?.distanceFromCenterMeters).toBeCloseTo(before!.distanceFromCenterMeters, 0);
}

test.afterEach(async ({ request }) => {
	await resetStub(request);
});

// Under reduced motion the globe never turns, so the camera at rest is the camera to compare.
test.describe('@webgl atlas marker visibility', () => {
	test.use({ reducedMotion: 'reduce' });

	test('hides and restores the markers on the same viewer, camera and chooser rules', async ({
		page,
		request
	}) => {
		await page.setViewportSize(DESKTOP);
		await useScenario(request, 'catalog');
		await page.goto('/atlas');
		await expectReadyStage(page);
		await cameraAtRest(page);
		await page.waitForFunction(() => 'next' in window);
		await canvas(page).evaluate((element) => element.setAttribute('data-probe', 'first-viewer'));
		const camera = await globePosition(page);
		const everything = await held(page);
		const inSight = await seen(page);
		expect(inSight.length).toBeGreaterThan(2);
		expect(await layer(page)).toMatchObject({ shown: true, layers: 1 });
		await expect(hide(page)).toBeVisible();
		await expect(show(page)).toHaveCount(0);

		// Everest, Kangchenjunga, Ama Dablam and Machapuchare share one point at this height.
		const crowded = (await layer(page)).markers.find(({ slug }) => slug === 'mount-everest');
		expect(crowded?.visible, 'Everest drawn').toBe(true);
		const box = (await canvas(page).boundingBox())!;
		const pair = { x: box.x + crowded!.window!.x, y: box.y + crowded!.window!.y };

		await test.step('an ambiguous press opens the chooser, and hiding closes it', async () => {
			await page.mouse.click(pair.x, pair.y);
			await expect(chooser(page)).toBeVisible();

			await hide(page).click();

			await expect(chooser(page)).toHaveCount(0);
			await expect(show(page)).toBeVisible();
			await expect(hide(page)).toHaveCount(0);
		});

		await test.step('nothing is drawn, hovered or heard while hidden', async () => {
			await framesPass(page, 4);
			const hidden = await layer(page);
			expect(hidden.shown).toBe(false);
			expect(hidden.hovered).toBeUndefined();
			expect(await seen(page)).toEqual([]);

			await page.mouse.move(pair.x, pair.y);
			await page.mouse.click(pair.x, pair.y);
			await framesPass(page, 6);
			await expect(page).toHaveURL(/\/atlas$/);
			await expect(chooser(page)).toHaveCount(0);
			expect((await layer(page)).hovered).toBeUndefined();
			const cursor = await canvas(page).evaluate((element) => getComputedStyle(element).cursor);
			expect(cursor).toBe('grab');
		});

		await test.step('the list keeps working while the globe is bare', async () => {
			await continent(page, 'Europe').click();
			await list(page)
				.getByRole('link', { name: new RegExp(OLYMPUS.name) })
				.hover();
			await framesPass(page, 4);
			expect((await layer(page)).preview).toBeUndefined();
			expect(await seen(page)).toEqual([]);
		});

		await test.step('the keyboard brings them back, with no camera move or new viewer', async () => {
			await show(page).focus();
			await page.keyboard.press('Space');

			await expect(hide(page)).toBeFocused();
			await expect.poll(() => seen(page)).toEqual(inSight);
			expect(await held(page)).toEqual(everything);
			expect(await layer(page)).toMatchObject({ shown: true, layers: 1 });
			await expectCameraUnmoved(page, camera);
			await expect(page.locator('main canvas[data-probe="first-viewer"]')).toHaveCount(1);
			expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		});

		await test.step('a restored marker is pressed like before', async () => {
			await page.mouse.click(pair.x, pair.y);

			await expect(chooser(page)).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(chooser(page)).toHaveCount(0);
		});
	});

	test('keeps the preference across a mountain page and back', async ({ page, request }) => {
		await page.setViewportSize(DESKTOP);
		await useScenario(request, 'catalog');
		await page.goto('/atlas');
		await expectReadyStage(page);
		await cameraAtRest(page);
		await page.waitForFunction(() => 'next' in window);
		await canvas(page).evaluate((element) => element.setAttribute('data-probe', 'first-viewer'));

		await hide(page).click();
		await expect(show(page)).toBeVisible();

		await continent(page, 'Europe').click();
		await list(page)
			.getByRole('link', { name: new RegExp(OLYMPUS.name) })
			.click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await expectReadyStage(page);
		await expect(show(page)).toBeVisible();

		await page.goBack();
		await expect(page).toHaveURL(/\/atlas$/);
		await expectReadyStage(page);
		await cameraAtRest(page);

		await expect(show(page)).toBeVisible();
		expect(await layer(page)).toMatchObject({ shown: false });
		expect(await seen(page)).toEqual([]);
		await expect(page.locator('main canvas[data-probe="first-viewer"]')).toHaveCount(1);

		await show(page).click();
		await expect.poll(async () => (await seen(page)).length).toBeGreaterThan(2);

		// A full load starts over: the preference lives in the page, not in storage.
		await page.goto('/');
		await expectReadyStage(page);
		await expect(hide(page)).toBeVisible();
		await expect(show(page)).toHaveCount(0);
	});

	test('restores the markers matching the filters chosen while hidden', async ({
		page,
		request
	}) => {
		await page.setViewportSize(DESKTOP);
		await useScenario(request, 'regions');
		await page.goto('/atlas');
		await expectReadyStage(page);
		await cameraAtRest(page);
		await page.waitForFunction(() => 'next' in window);
		await canvas(page).evaluate((element) => element.setAttribute('data-probe', 'first-viewer'));
		expect(await held(page)).toHaveLength(8);

		await hide(page).click();
		await expect.poll(async () => (await layer(page)).shown).toBe(false);

		await openFilters(page);
		await chooseCountry(page, 'Chile');
		// The country filter reframes the camera on Chile, hidden markers or not; what restoring must
		// leave alone is that framing.
		await cameraAtRest(page);
		const framed = await globePosition(page);
		expect(await layer(page)).toMatchObject({ shown: false });
		expect(await seen(page)).toEqual([]);

		await show(page).click();

		await expect.poll(() => held(page)).toEqual(['almost-six', 'fitz-roy', 'six-thousand']);
		expect(await layer(page)).toMatchObject({ shown: true });
		expect(await layer(page)).toMatchObject({ shown: true, layers: 1, entities: 3 });
		await expect(page.locator('main canvas[data-probe="first-viewer"]')).toHaveCount(1);
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		await expectCameraUnmoved(page, framed);
	});

	for (const [width, height] of [
		[568, 320],
		[667, 375],
		[1000, 420],
		[1000, 360],
		[1280, 320]
	] as const) {
		test(`keeps the full toolbar inside the stage and clear of the compass at ${width}x${height}`, async ({
			page,
			request
		}) => {
			await page.emulateMedia({ reducedMotion: 'no-preference' });
			await page.setViewportSize({ width, height });
			await useScenario(request, 'catalog');
			await page.goto('/atlas');
			await expectReadyStage(page);
			await expect(page.getByRole('button', { name: 'Pause globe rotation' })).toBeVisible();

			const { buttons, compass, scene } = await page.evaluate(() => {
				const rect = (element: Element) => {
					const { left, top, right, bottom } = element.getBoundingClientRect();
					return { left, top, right, bottom };
				};
				const root = document.querySelector('main [data-stage]')!;
				const readout = [...root.querySelectorAll('p')].find((p) => p.getAttribute('aria-hidden'))!;
				const visible = [...root.querySelectorAll('button')].filter(
					(button) => button.offsetParent !== null
				);
				const toolbar = [...visible].filter(
					(button) => button.offsetParent === visible[0]!.offsetParent && button.closest('div')
				);
				return {
					buttons: toolbar.map((button) => rect(button)),
					compass: rect(readout.parentElement!),
					scene: rect(visible[0]!.offsetParent!)
				};
			});

			const overlapping = buttons.filter(
				(b) =>
					b.left < compass.right &&
					b.right > compass.left &&
					b.top < compass.bottom &&
					b.bottom > compass.top
			);
			expect(overlapping).toEqual([]);
			for (const b of buttons) {
				expect(b.right).toBeLessThanOrEqual(scene.right + 0.5);
				expect(b.bottom).toBeLessThanOrEqual(scene.bottom + 0.5);
			}
		});
	}

	for (const viewport of [
		{ name: 'a phone', width: 390, height: 844 },
		{ name: 'the narrowest phone', width: 320, height: 568 }
	]) {
		test(`sits in the toolbar without overlap on ${viewport.name}, and in fullscreen`, async ({
			page,
			request
		}) => {
			await page.setViewportSize({ width: viewport.width, height: viewport.height });
			await useScenario(request, 'catalog');
			await page.goto('/atlas');
			await expectReadyStage(page);

			// One evaluation reads the stage and its buttons in the same frame, so a scroll between two
			// reads cannot shear the comparison.
			const expectToolbar = async (names: readonly string[]) => {
				const { stage, boxes } = await page.evaluate((labels) => {
					const rect = (element: Element) => {
						const { x, y, width, height } = element.getBoundingClientRect();
						return { x, y, width, height };
					};
					const root = document.querySelector('main [data-stage]')!;
					const buttons = [...root.querySelectorAll('button')];
					// A button's offsetParent is its tooltip anchor, so the canvas, which fills the stage, bounds it.
					const scene = root.querySelector('canvas')!;
					return {
						stage: rect(scene),
						boxes: labels.map((label) => {
							const found = buttons.find((button) => button.textContent?.trim() === label);
							return found ? rect(found) : undefined;
						})
					};
				}, names);

				for (const [index, box] of boxes.entries()) {
					expect(box, names[index]).toBeDefined();
					expect(box!.width).toBeCloseTo(44, 0);
					expect(box!.height).toBeCloseTo(44, 0);
					expect(box!.x).toBeGreaterThanOrEqual(stage.x - 0.5);
					expect(box!.x + box!.width).toBeLessThanOrEqual(stage.x + stage.width + 0.5);
					expect(box!.y).toBeGreaterThanOrEqual(stage.y - 0.5);
					expect(box!.y + box!.height).toBeLessThanOrEqual(stage.y + stage.height + 0.5);
					if (index > 0) {
						const above = boxes[index - 1]!;
						expect(box!.y).toBeGreaterThanOrEqual(above.y + above.height);
					}
				}
			};

			await expectToolbar(['Reset view', 'Hide mountain markers', 'Enter fullscreen']);
			await hide(page).click();
			await expect(show(page)).toBeVisible();
			await expectToolbar(['Reset view', 'Show mountain markers', 'Enter fullscreen']);

			await page.getByRole('button', { name: 'Enter fullscreen' }).click();
			await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
			await expectToolbar(['Reset view', 'Show mountain markers', 'Exit fullscreen']);
			expect(await layer(page)).toMatchObject({ shown: false });

			await show(page).click();
			await expect.poll(async () => (await layer(page)).shown).toBe(true);
			await page.getByRole('button', { name: 'Exit fullscreen' }).click();
		});
	}
});
