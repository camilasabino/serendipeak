import type { Page } from '@playwright/test';
import { ATLAS_LOOK } from '../../src/stage/globe/atlasLook';
import { atlasLink, item, layer, openContinent, servedIndex } from './support/atlas';
import {
	ACONCAGUA,
	DESKTOP,
	atlasLook,
	expect,
	expectCanonicalPose,
	expectReadyStage,
	globePosition,
	liveViewers,
	test,
	type AtlasLookReading
} from './support/stage';

async function look(page: Page): Promise<AtlasLookReading> {
	const reading = await atlasLook(page);
	expect(reading).toBeDefined();
	return reading!;
}

async function expectWorn(page: Page) {
	await expect.poll(async () => (await look(page)).intensity, { timeout: 30_000 }).toBe(1);
	const reading = await look(page);
	expect(reading.skyBoxShown).toBe(true);
	expect(reading.layerSaturation).toBeCloseTo(ATLAS_LOOK.layer.saturation, 6);
	expect(reading.background.red).toBeCloseTo(ATLAS_LOOK.background.red, 6);
	expect(reading.background.green).toBeCloseTo(ATLAS_LOOK.background.green, 6);
	expect(reading.background.blue).toBeCloseTo(ATLAS_LOOK.background.blue, 6);
	expect((await globePosition(page))!.heightMeters).toBeGreaterThan(ATLAS_LOOK.fullAboveMeters);
}

async function expectOriginalLook(page: Page) {
	await expect.poll(async () => (await look(page)).intensity, { timeout: 30_000 }).toBe(0);
	// The look is gone for good: the frame listener is released and every captured value is back.
	await expect.poll(async () => (await look(page)).listening).toBe(false);
	expect(await look(page)).toMatchObject({
		skyBoxShown: true,
		layerSaturation: 1,
		background: { red: 0, green: 0, blue: 0 }
	});
}

async function expectOneViewer(page: Page, probe: { contextsLive(): Promise<number> }) {
	expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
	expect(await probe.contextsLive()).toBe(1);
}

test.describe('@webgl atlas look', () => {
	test('is worn on the atlas, gone on a mountain, and back on the atlas, on one Viewer', async ({
		page,
		probe,
		request
	}) => {
		const entries = await servedIndex(request);
		await page.setViewportSize(DESKTOP);

		await test.step('Today keeps the original look, stars included, from its first frame', async () => {
			await page.goto(`/mountains/${ACONCAGUA.slug}`);
			await expectReadyStage(page);
			await expectCanonicalPose(page, ACONCAGUA.camera);
			await expectOriginalLook(page);
		});

		await test.step('the atlas wears it at the global overview, markers untouched', async () => {
			await atlasLink(page).click();
			await expect(page).toHaveURL(/\/atlas$/);
			await expectWorn(page);
			expect(await layer(page)).toMatchObject({ shown: true, layers: 1, entities: entries.length });
		});

		await test.step('choosing a mountain restores the standard look', async () => {
			await openContinent(page, 'South America');
			await item(page, ACONCAGUA.name).click();
			await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
			await expectCanonicalPose(page, ACONCAGUA.camera);
			await expectOriginalLook(page);
		});

		await test.step('returning to the atlas wears it again', async () => {
			await page.goBack();
			await expect(page).toHaveURL(/\/atlas$/);
			await expectWorn(page);
			expect(await layer(page)).toMatchObject({ shown: true, entities: entries.length });
		});

		await expectOneViewer(page, probe);
	});

	test('is worn from the first frame of an atlas opened directly, before any marker', async ({
		page,
		probe
	}) => {
		await page.setViewportSize(DESKTOP);
		await page.goto('/atlas');
		await expectReadyStage(page);

		await expectWorn(page);
		await expectOneViewer(page, probe);
	});

	test('changes at once, with no fade, when the reader prefers reduced motion', async ({
		page,
		probe
	}) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.setViewportSize(DESKTOP);
		await page.goto('/atlas');
		await expectReadyStage(page);
		await expectWorn(page);

		await openContinent(page, 'South America');
		await item(page, ACONCAGUA.name).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));

		await expectCanonicalPose(page, ACONCAGUA.camera);
		await expectOriginalLook(page);
		await expectOneViewer(page, probe);
	});

	test('keeps the scene look when the base imagery cannot be created, and restores it on a mountain', async ({
		page,
		probe
	}) => {
		probe.tolerate({
			requests: /api\.cesium\.com\/v1\/assets\/3954\/endpoint/,
			errors: /Failed to load resource: the server responded with a status of 500/
		});
		await page.route('https://api.cesium.com/v1/assets/3954/endpoint**', (route) =>
			route.fulfill({ status: 500, body: 'unavailable' })
		);
		await page.setViewportSize(DESKTOP);
		await page.goto('/atlas');
		// A degraded stage announces its notice, so the stage is ready when its controls are.
		await expect(page.getByRole('button', { name: 'Reset view' })).toBeEnabled({ timeout: 60_000 });

		await expect.poll(async () => (await look(page)).intensity, { timeout: 30_000 }).toBe(1);
		await expect.poll(async () => (await look(page)).layerSaturation).toBeUndefined();
		expect((await look(page)).skyBoxShown).toBe(true);

		await openContinent(page, 'South America');
		await item(page, ACONCAGUA.name).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
		await expectCanonicalPose(page, ACONCAGUA.camera);
		await expect.poll(async () => (await look(page)).intensity).toBe(0);
		expect(await look(page)).toMatchObject({
			skyBoxShown: true,
			background: { red: 0, green: 0, blue: 0 }
		});
		await expectOneViewer(page, probe);
	});
});
