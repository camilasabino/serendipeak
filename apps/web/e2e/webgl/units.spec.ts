import type { Page } from '@playwright/test';
import { resetStub, useScenario } from '../ssr/support';
import { chooseCountry, list } from './support/atlasList';
import {
	ACONCAGUA,
	DESKTOP,
	OLYMPUS,
	atlasLayer,
	cameraAtRest,
	cameraReading,
	dragGlobe,
	expect,
	expectCanonicalPose,
	expectReadyStage,
	framesPass,
	globePosition,
	poseDifference,
	test,
	type AtlasLayerReading
} from './support/stage';
import { scaleSpecForStage } from '../../src/stage/globe/scaleBar';
import { readSummit } from './support/summit';

const METERS_PER_FOOT = 0.3048;
const METERS_PER_MILE = 5280 * METERS_PER_FOOT;
const SCALE_MAX_WIDTH_PX = 120;

const units = (page: Page) => page.getByRole('group', { name: 'Units' });
const metric = (page: Page) => units(page).getByRole('button', { name: 'Metric, meters' });
const imperial = (page: Page) => units(page).getByRole('button', { name: 'Imperial, feet' });
const canvas = (page: Page) => page.locator('main canvas');

interface ScaleBar {
	text: string;
	widthPx: number;
	groundMeters: number;
}

async function readScale(page: Page): Promise<ScaleBar | undefined> {
	const raw = await page.evaluate(() => {
		const label = [...document.querySelectorAll('p')].find((p) =>
			p.textContent?.startsWith('Scale:')
		);
		if (!label) {
			return undefined;
		}

		return {
			text: label.textContent!.replace('Scale:', '').trim(),
			widthPx: Number(label.nextElementSibling?.getAttribute('width'))
		};
	});
	if (!raw) {
		return undefined;
	}
	const [, figure, unit] = /^([\d,]+) (m|km|ft|mi)$/.exec(raw.text) ?? [];
	expect(unit, `a scale label in a known unit: ${raw.text}`).toBeDefined();
	const perUnit = { m: 1, km: 1000, ft: METERS_PER_FOOT, mi: METERS_PER_MILE }[
		unit as 'm' | 'km' | 'ft' | 'mi'
	];

	return { ...raw, groundMeters: Number(figure!.replace(/,/g, '')) * perUnit };
}

async function scale(page: Page): Promise<ScaleBar> {
	let bar: ScaleBar | undefined;
	await expect
		.poll(async () => (bar = await readScale(page)) !== undefined, { timeout: 30_000 })
		.toBe(true);

	return bar!;
}

async function scaleIn(page: Page, unit: RegExp): Promise<ScaleBar> {
	let bar: ScaleBar | undefined;
	await expect
		.poll(async () => unit.test((bar = await readScale(page))?.text ?? ''), { timeout: 30_000 })
		.toBe(true);

	return bar!;
}

// The bar is as wide as the ground it names, so ground over width is the view's meters per pixel
// whichever system words it.
const metersPerPixel = (bar: ScaleBar) => bar.groundMeters / bar.widthPx;

async function summitPillWidth(page: Page): Promise<number> {
	let width = 0;
	await expect
		.poll(
			async () => {
				const pill = (await readSummit(page))?.pill;
				width = pill ? pill.right - pill.left : 0;
				return width;
			},
			{ message: 'the summit pill is drawn' }
		)
		.toBeGreaterThan(40);

	return width;
}

async function layer(page: Page): Promise<AtlasLayerReading> {
	const reading = await atlasLayer(page);
	expect(reading).toBeDefined();
	return reading!;
}

async function viewers(page: Page) {
	return page.evaluate(() => ({
		canvases: document.querySelectorAll('canvas').length,
		viewers: document.querySelectorAll('.cesium-viewer').length
	}));
}

async function previewWidth(page: Page, slug: string): Promise<number> {
	let width = 0;
	await expect
		.poll(async () => {
			const preview = (await layer(page)).preview;
			width = preview && preview.slug === slug ? preview.box.right - preview.box.left : 0;
			return width;
		})
		.toBeGreaterThan(40);

	return width;
}

// A click through the page moves the pointer off the globe, which ends a hover; this one does not.
async function chooseWithoutPointer(page: Page, name: 'Imperial, feet' | 'Metric, meters') {
	await units(page)
		.getByRole('button', { name })
		.evaluate((button) => (button as HTMLElement).click());
}

async function hover(page: Page, slug: string) {
	const marker = (await layer(page)).markers.find((entry) => entry.slug === slug);
	expect(marker?.visible, `${slug} drawn`).toBe(true);
	const box = (await canvas(page).boundingBox())!;
	await page.mouse.move(box.x + marker!.window!.x, box.y + marker!.window!.y);
	await expect.poll(async () => (await layer(page)).hovered).toBe(slug);
}

test.beforeEach(async ({ page, request }) => {
	await page.setViewportSize(DESKTOP);
	await useScenario(request, 'catalog');
});

test.afterEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('@webgl unit system on the stage', () => {
	test.describe('at rest', () => {
		test.use({ reducedMotion: 'reduce' });

		test('words the summit pill and the scale bar in the chosen unit, in place', async ({
			page,
			probe
		}) => {
			await page.goto(`/mountains/${ACONCAGUA.slug}`);
			await expectReadyStage(page);
			await expectCanonicalPose(page, ACONCAGUA.camera);
			const metricWidth = await summitPillWidth(page);
			const metricBar = await scaleIn(page, /^[\d,]+ k?m$/);
			const pose = await cameraReading(page);
			expect(await probe.contextsCreated()).toBe(1);

			await imperial(page).click();

			// "22,838 ft" is a little wider than "6,961 m" at the same type size.
			await expect.poll(() => summitPillWidth(page)).toBeGreaterThan(metricWidth + 2);
			const imperialBar = await scaleIn(page, /^[\d,]+ (ft|mi)$/);
			expect(Math.abs(metersPerPixel(imperialBar) / metersPerPixel(metricBar) - 1)).toBeLessThan(
				0.03
			);
			expect(await cameraReading(page)).toEqual(pose);
			expect(await probe.contextsCreated()).toBe(1);
			expect(await viewers(page)).toEqual({ canvases: 1, viewers: 1 });

			await metric(page).click();

			await expect.poll(() => summitPillWidth(page)).toBe(metricWidth);
			await scaleIn(page, /^[\d,]+ k?m$/);
			expect(await cameraReading(page)).toEqual(pose);
		});

		test('ends on the last unit after a burst of toggles', async ({ page }) => {
			await page.goto(`/mountains/${ACONCAGUA.slug}`);
			await expectReadyStage(page);
			const metricWidth = await summitPillWidth(page);
			await scaleIn(page, /^[\d,]+ k?m$/);

			for (const system of [imperial, metric, imperial, metric, imperial]) {
				await system(page).click();
			}

			await scaleIn(page, /^[\d,]+ (ft|mi)$/);
			await expect.poll(() => summitPillWidth(page)).toBeGreaterThan(metricWidth + 2);
			await framesPass(page, 12);
			await scaleIn(page, /^[\d,]+ (ft|mi)$/);

			await metric(page).click();
			await scaleIn(page, /^[\d,]+ k?m$/);
			await expect.poll(() => summitPillWidth(page)).toBe(metricWidth);
		});

		test('keeps the bar true to the ground, in feet and in miles, at every zoom level', async ({
			page
		}) => {
			await page.goto(`/mountains/${ACONCAGUA.slug}`);
			await expectReadyStage(page);
			const sweep = async (steps: number, button: 'Zoom in' | 'Zoom out') => {
				for (let step = 0; step < steps; step += 1) {
					await page.getByRole('button', { name: button }).click();
					await framesPass(page, 8);
					await cameraAtRest(page);

					const pair: ScaleBar[] = [];
					for (const system of [metric, imperial]) {
						await system(page).click();
						await framesPass(page, 8);
						pair.push(await scale(page));
					}
					const [meters, feet] = pair as [ScaleBar, ScaleBar];
					expect(meters.text).toMatch(/ k?m$/);
					expect(feet.text).toMatch(/ (ft|mi)$/);
					for (const bar of pair) {
						expect(bar.widthPx).toBeLessThanOrEqual(SCALE_MAX_WIDTH_PX);
						expect(bar.widthPx).toBeGreaterThanOrEqual(SCALE_MAX_WIDTH_PX * 0.4 - 1);
					}
					expect(Math.abs(metersPerPixel(feet) / metersPerPixel(meters) - 1)).toBeLessThan(0.03);
					await metric(page).click();
				}
			};

			await sweep(3, 'Zoom in');
			await sweep(6, 'Zoom out');
		});

		test('redraws an atlas preview in place, leaving the camera and the markers alone', async ({
			page,
			probe
		}) => {
			await page.goto('/atlas');
			await expectReadyStage(page);
			await cameraAtRest(page);
			await hover(page, OLYMPUS.slug);
			const metricWidth = await previewWidth(page, OLYMPUS.slug);
			const before = await layer(page);
			const position = await globePosition(page);

			await chooseWithoutPointer(page, 'Imperial, feet');

			// The pointer has not moved: the same marker is still the one emphasized, and its pill
			// is a different one: "9,573 ft" is not as wide as "2,918 m".
			await expect
				.poll(async () => Math.abs((await previewWidth(page, OLYMPUS.slug)) - metricWidth))
				.toBeGreaterThanOrEqual(1);
			const after = await layer(page);
			expect(after.hovered).toBe(OLYMPUS.slug);
			expect(after.entities).toBe(before.entities);
			expect(after.layers).toBe(before.layers);
			expect(after.markers.map(({ slug, visible, window }) => ({ slug, visible, window }))).toEqual(
				before.markers.map(({ slug, visible, window }) => ({ slug, visible, window }))
			);
			expect(await globePosition(page)).toEqual(position);
			expect(await probe.contextsCreated()).toBe(1);

			await chooseWithoutPointer(page, 'Metric, meters');
			await expect.poll(() => previewWidth(page, OLYMPUS.slug)).toBe(metricWidth);
		});

		test('leaves an Argentina framing, its filter and its markers as they were', async ({
			page,
			request
		}) => {
			await useScenario(request, 'regions');
			await page.goto('/atlas');
			await expectReadyStage(page);
			await cameraAtRest(page);
			await chooseCountry(page, 'Argentina');
			await framesPass(page, 12);
			await cameraAtRest(page);
			const framed = await globePosition(page);
			const markers = await layer(page);
			const country = list(page).getByRole('button', { name: /^Country/ });
			const filter = await country.textContent();
			expect(filter).toContain('Argentina');

			await imperial(page).click();
			await framesPass(page, 12);
			await metric(page).click();
			await imperial(page).click();
			await framesPass(page, 12);
			await cameraAtRest(page);

			expect(await globePosition(page)).toEqual(framed);
			expect(await country.textContent()).toBe(filter);
			const after = await layer(page);
			expect(after.entities).toBe(markers.entities);
			expect(after.markers.filter((entry) => entry.visible).map((entry) => entry.slug)).toEqual(
				markers.markers.filter((entry) => entry.visible).map((entry) => entry.slug)
			);
			expect(await viewers(page)).toEqual({ canvases: 1, viewers: 1 });
		});

		test('follows an imperial choice from the atlas to a mountain, back, and through a reload', async ({
			page
		}) => {
			await page.goto('/atlas');
			await expectReadyStage(page);
			await imperial(page).click();
			await expect(imperial(page)).toHaveAttribute('aria-pressed', 'true');

			await page.goto(`/mountains/${ACONCAGUA.slug}`);
			await expectReadyStage(page);
			await expect(imperial(page)).toHaveAttribute('aria-pressed', 'true');
			await scaleIn(page, /^[\d,]+ (ft|mi)$/);
			const imperialWidth = await summitPillWidth(page);

			await page.goBack();
			await expectReadyStage(page);
			await cameraAtRest(page);
			await expect(imperial(page)).toHaveAttribute('aria-pressed', 'true');
			await hover(page, OLYMPUS.slug);
			expect(await previewWidth(page, OLYMPUS.slug)).toBeGreaterThan(40);

			await page.goForward();
			await expectReadyStage(page);
			await scaleIn(page, /^[\d,]+ (ft|mi)$/);
			expect(await summitPillWidth(page)).toBe(imperialWidth);

			await page.reload();
			await expectReadyStage(page);
			await expect(imperial(page)).toHaveAttribute('aria-pressed', 'true');
			await scaleIn(page, /^[\d,]+ (ft|mi)$/);
			expect(await summitPillWidth(page)).toBe(imperialWidth);
		});
	});

	test.describe('on the phone layout', () => {
		test.use({ reducedMotion: 'reduce' });

		test('keeps the shorter bar within its width in both units and draws no pill', async ({
			page
		}) => {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.goto(`/mountains/${ACONCAGUA.slug}`);
			await expectReadyStage(page);
			await expect(imperial(page)).toBeVisible();
			const stage = (await canvas(page).boundingBox())!;
			expect(stage.width).toBeLessThan(560);
			const maxWidth = scaleSpecForStage(stage.width).maxWidthPx;

			const metricBar = await scaleIn(page, /^[\d,]+ k?m$/);
			await imperial(page).click();
			const imperialBar = await scaleIn(page, /^[\d,]+ (ft|mi)$/);

			for (const bar of [metricBar, imperialBar]) {
				expect(bar.widthPx, `${bar.text} on a ${stage.width}px stage`).toBeLessThanOrEqual(
					maxWidth
				);
				expect(bar.widthPx).toBeGreaterThanOrEqual(maxWidth * 0.4 - 1);
			}
			expect(Math.abs(metersPerPixel(imperialBar) / metersPerPixel(metricBar) - 1)).toBeLessThan(
				0.03
			);
			expect((await readSummit(page))?.pill).toBeUndefined();
			expect((await readSummit(page))?.disc).toBeDefined();
		});
	});

	test('does not interrupt a reset flight, and the camera still arrives', async ({
		page,
		probe
	}) => {
		await page.goto(`/mountains/${ACONCAGUA.slug}`);
		await expectReadyStage(page);
		await expectCanonicalPose(page, ACONCAGUA.camera);
		await dragGlobe(page, 0.25, 0.1);
		await cameraAtRest(page);
		expect(poseDifference(await cameraReading(page), ACONCAGUA.camera)).toBeDefined();

		// The toggles land while the flight is still in the air: the pose has not arrived yet.
		// One task: the flight cannot arrive between the reset and the toggles.
		await page.evaluate(() => {
			const press = (name: string) =>
				[...document.querySelectorAll('button')]
					.find((button) => (button.getAttribute('aria-label') ?? button.textContent) === name)
					?.click();
			press('Reset view');
			press('Imperial, feet');
			press('Metric, meters');
			press('Imperial, feet');
		});
		const flying = poseDifference(await cameraReading(page), ACONCAGUA.camera);
		expect(flying, 'the flight was still under way when the unit changed').toBeDefined();

		await expectCanonicalPose(page, ACONCAGUA.camera);
		await scaleIn(page, /^[\d,]+ (ft|mi)$/);
		expect(await probe.contextsCreated()).toBe(1);
		expect(await viewers(page)).toEqual({ canvases: 1, viewers: 1 });
	});

	test('keeps the atlas turning through a unit change', async ({ page, probe }) => {
		await page.goto('/atlas');
		await expectReadyStage(page);
		await expect.poll(async () => (await globePosition(page))?.orbiting).toBe(true);

		await imperial(page).click();
		await framesPass(page, 10);
		await metric(page).click();
		await framesPass(page, 10);

		expect((await globePosition(page))?.orbiting).toBe(true);
		expect(await probe.contextsCreated()).toBe(1);
	});
});
