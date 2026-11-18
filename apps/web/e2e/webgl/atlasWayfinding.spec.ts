import type { Page } from '@playwright/test';
import { SUMMIT_MARKER_STYLE } from '../../src/stage/globe/marker';
import { resetStub, useScenario } from '../ssr/support';
import { continent, item, openContinent, pauseRotation, servedIndex } from './support/atlas';
import {
	DESKTOP,
	OLYMPUS,
	atlasLayer,
	cameraAtRest,
	expect,
	expectReadyStage,
	framesPass,
	globePosition,
	liveViewers,
	test,
	type AtlasLayerReading
} from './support/stage';

interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

const canvas = (page: Page) => page.locator('main canvas');

async function layer(page: Page): Promise<AtlasLayerReading> {
	const reading = await atlasLayer(page);
	expect(reading).toBeDefined();
	return reading!;
}

async function window(page: Page, slug: string) {
	const marker = (await layer(page)).markers.find((entry) => entry.slug === slug);
	expect(marker?.visible, `${slug} drawn`).toBe(true);
	return marker!.window!;
}

async function pointAt(page: Page, at: { x: number; y: number }) {
	const box = (await canvas(page).boundingBox())!;
	await page.mouse.move(box.x + at.x, box.y + at.y);
}

/**
 * What the canvas shows inside a box: how much of it is basalt, and how many pixels are copper. A
 * summit pill is a basalt plate with a copper elevation, and nothing else on the stage is either.
 */
async function inkIn(page: Page, box: Box) {
	const stage = (await canvas(page).boundingBox())!;
	const shot = (
		await page.screenshot({
			clip: {
				x: stage.x + box.left,
				y: stage.y + box.top,
				width: box.right - box.left,
				height: box.bottom - box.top
			}
		})
	).toString('base64');

	return page.evaluate(
		async ({ png, colors }) => {
			const image = new Image();
			image.src = `data:image/png;base64,${png}`;
			await image.decode();
			const surface = new OffscreenCanvas(image.width, image.height).getContext('2d')!;
			surface.drawImage(image, 0, 0);
			const { data } = surface.getImageData(0, 0, image.width, image.height);
			const near = (at: number, hex: string, tolerance: number) => {
				const value = Number.parseInt(hex.slice(1), 16);
				return (
					Math.abs(data[at]! - (value >> 16)) <= tolerance &&
					Math.abs(data[at + 1]! - ((value >> 8) & 255)) <= tolerance &&
					Math.abs(data[at + 2]! - (value & 255)) <= tolerance
				);
			};
			let basalt = 0;
			let copper = 0;
			for (let at = 0; at < data.length; at += 4) {
				basalt += near(at, colors.basalt, 8) ? 1 : 0;
				copper += near(at, colors.copper, 40) ? 1 : 0;
			}

			return { basalt: basalt / (data.length / 4), copper };
		},
		{ png: shot, colors: SUMMIT_MARKER_STYLE.colors }
	);
}

const ELBRUS = { slug: 'mount-elbrus', name: 'Mount Elbrus' };
const DRAWN_PILL = { basalt: 0.5, copper: 12 };

test.beforeEach(async ({ page, request }) => {
	await page.setViewportSize(DESKTOP);
	await useScenario(request, 'catalog');
});

test.afterEach(async ({ request }) => {
	await resetStub(request);
});

async function pausedOverview(page: Page) {
	await page.goto('/atlas');
	await expectReadyStage(page);
	await pauseRotation(page).click();
	await cameraAtRest(page);
}

test.describe('@webgl atlas wayfinding', () => {
	test('a marker under the mouse is named by a pill, which goes when the mouse leaves', async ({
		page,
		request
	}) => {
		const entries = await servedIndex(request);
		await pausedOverview(page);
		const at = await window(page, OLYMPUS.slug);
		const bare = { x: at.x, y: at.y + 90 };

		await test.step('the pill appears above the marker, inside the stage, drawn in basalt and copper', async () => {
			await pointAt(page, at);
			await expect.poll(async () => (await layer(page)).preview?.slug).toBe(OLYMPUS.slug);

			const reading = await layer(page);
			const { box } = reading.preview!;
			const stage = (await canvas(page).boundingBox())!;
			expect(reading.hovered).toBe(OLYMPUS.slug);
			expect(box.bottom).toBeLessThan(at.y);
			expect(box.left).toBeGreaterThanOrEqual(0);
			expect(box.top).toBeGreaterThanOrEqual(0);
			expect(box.right).toBeLessThanOrEqual(stage.width);
			expect((box.left + box.right) / 2).toBeCloseTo(at.x, 0);
			await expect
				.poll(async () => {
					const ink = await inkIn(page, box);
					return ink.basalt >= DRAWN_PILL.basalt && ink.copper >= DRAWN_PILL.copper;
				})
				.toBe(true);
		});

		await test.step('it names a marker the ordinary labels would not, from the whole-globe distance', async () => {
			const reading = await layer(page);
			const marker = reading.markers.find((entry) => entry.slug === OLYMPUS.slug)!;
			expect(marker.labelShown).toBe(false);
			expect(reading.markers.filter((entry) => entry.labelShown)).toEqual([]);
		});

		await test.step('leaving the marker takes the pill away', async () => {
			await pointAt(page, bare);
			await expect.poll(async () => (await layer(page)).preview).toBeUndefined();

			const reading = await layer(page);
			expect(reading.hovered).toBeUndefined();
			await expect
				.poll(
					async () =>
						(
							await inkIn(page, {
								left: at.x - 70,
								right: at.x + 70,
								top: at.y - 70,
								bottom: at.y - 28
							})
						).copper
				)
				.toBeLessThan(DRAWN_PILL.copper);
		});

		await test.step('the layer is still one layer of one entity per mountain, on one Viewer', async () => {
			expect(await layer(page)).toMatchObject({
				layers: 1,
				entities: entries.length
			});
			expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		});
	});

	test('a list row emphasizes its marker by mouse and by keyboard, and moves nothing', async ({
		page
	}) => {
		await pausedOverview(page);
		await openContinent(page, 'Europe');
		const before = await globePosition(page);
		const highlighted = async () => (await layer(page)).highlighted;
		const previewed = async () => (await layer(page)).preview?.slug;

		await test.step('hovering a row emphasizes its marker and names it, then the next row takes over', async () => {
			await item(page, OLYMPUS.name).hover();
			await expect.poll(highlighted).toBe(OLYMPUS.slug);
			await expect.poll(previewed).toBe(OLYMPUS.slug);

			await item(page, ELBRUS.name).hover();
			await expect.poll(highlighted).toBe(ELBRUS.slug);
			await expect.poll(previewed).toBe(ELBRUS.slug);

			await page.mouse.move(2, 2);
			await expect.poll(highlighted).toBeUndefined();
			await expect.poll(previewed).toBeUndefined();
		});

		await test.step('focusing a row by keyboard does the same, and leaving it ends it', async () => {
			await item(page, OLYMPUS.name).focus();
			await expect.poll(highlighted).toBe(OLYMPUS.slug);
			await expect.poll(previewed).toBe(OLYMPUS.slug);

			await page.keyboard.press('Tab');
			await expect.poll(highlighted).toBeDefined();
			expect(await highlighted()).not.toBe(OLYMPUS.slug);

			await page.evaluate(() => (document.activeElement as HTMLElement).blur());
			await expect.poll(highlighted).toBeUndefined();
		});

		await test.step('a pointer on a marker comes first, and the row takes over again afterwards', async () => {
			await item(page, OLYMPUS.name).focus();
			await expect.poll(highlighted).toBe(OLYMPUS.slug);

			await pointAt(page, await window(page, ELBRUS.slug));
			await expect.poll(async () => (await layer(page)).hovered).toBe(ELBRUS.slug);
			await expect.poll(previewed).toBe(ELBRUS.slug);

			await pointAt(page, { x: 2, y: 2 });
			await expect.poll(previewed).toBe(OLYMPUS.slug);
			await page.evaluate(() => (document.activeElement as HTMLElement).blur());
			await expect.poll(previewed).toBeUndefined();
		});

		await test.step('the camera never moved', async () => {
			await framesPass(page, 6);
			expect(await globePosition(page)).toEqual(before);
			expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		});
	});

	test('a marker on the far side shows nothing for its row, and the camera stays put', async ({
		page
	}) => {
		await pausedOverview(page);
		await openContinent(page, 'South America');
		const before = await globePosition(page);
		expect((await layer(page)).markers.find((entry) => entry.slug === 'aconcagua')?.visible).toBe(
			false
		);

		await item(page, 'Aconcagua').hover();
		await expect.poll(async () => (await layer(page)).highlighted).toBe('aconcagua');
		await framesPass(page, 6);

		expect((await layer(page)).preview).toBeUndefined();
		expect(await globePosition(page)).toEqual(before);
	});

	test('following a row ends its emphasis, and the next visit to the atlas starts without one', async ({
		page
	}) => {
		await pausedOverview(page);
		await openContinent(page, 'Europe');
		await item(page, OLYMPUS.name).hover();
		await expect.poll(async () => (await layer(page)).highlighted).toBe(OLYMPUS.slug);

		await item(page, OLYMPUS.name).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await expect.poll(async () => (await layer(page)).shown).toBe(false);
		expect((await layer(page)).highlighted).toBeUndefined();

		await page.goBack();
		await expect(page).toHaveURL(/\/atlas$/);
		await expectReadyStage(page);
		await expect.poll(async () => (await layer(page)).shown).toBe(true);
		const reading = await layer(page);
		expect(reading.highlighted).toBeUndefined();
		expect(reading.preview).toBeUndefined();
		expect(reading).toMatchObject({ layers: 1 });
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
	});

	test('opens with every continent collapsed, and keeps what the reader chose', async ({
		page
	}) => {
		await page.goto('/atlas');
		await expectReadyStage(page);

		const open = async () =>
			page
				.getByRole('region', { name: 'All mountains' })
				.locator('details')
				.evaluateAll((groups) => groups.map((group) => (group as HTMLDetailsElement).open));
		const first = await open();
		expect(first.length).toBeGreaterThan(1);
		expect(first.every((state) => !state)).toBe(true);

		await continent(page, 'Europe').click();
		await continent(page, 'Africa').click();
		const chosen = await open();
		await item(page, OLYMPUS.name).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await page.goBack();
		await expect(page).toHaveURL(/\/atlas$/);

		await expect.poll(open).toEqual(chosen);
	});
});
