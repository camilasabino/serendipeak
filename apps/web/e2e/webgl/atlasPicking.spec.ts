import type { Page } from '@playwright/test';
import { resetStub, useScenario } from '../ssr/support';
import {
	DESKTOP,
	OLYMPUS,
	atlasLayer,
	cameraAtRest,
	expect,
	expectCanonicalPose,
	expectReadyStage,
	framesPass,
	liveViewers,
	test,
	type AtlasLayerReading,
	type AtlasMarkerReading
} from './support/stage';

// The reach of a fingertip, the widest hit area the picker documents, in CSS pixels.
const FINGER_REACH = 22;

interface Point {
	x: number;
	y: number;
}

const chooser = (page: Page) => page.getByRole('dialog', { name: 'Which mountain?' });
const canvas = (page: Page) => page.locator('main canvas');

async function layer(page: Page): Promise<AtlasLayerReading> {
	const reading = await atlasLayer(page);
	expect(reading).toBeDefined();
	return reading!;
}

async function shown(page: Page, slug: string): Promise<AtlasMarkerReading & { window: Point }> {
	const found = (await layer(page)).markers.find((entry) => entry.slug === slug);
	expect(found?.visible, `${slug} drawn`).toBe(true);
	return found as AtlasMarkerReading & { window: Point };
}

/** Where a canvas point is on the page. */
async function onPage(page: Page, point: Point): Promise<Point> {
	const box = (await canvas(page).boundingBox())!;
	return { x: box.x + point.x, y: box.y + point.y };
}

async function clickCanvas(page: Page, point: Point) {
	const at = await onPage(page, point);
	await page.mouse.click(at.x, at.y);
}

/** The nearest other drawn marker, to check a press lands where only one mountain is meant. */
function nearestOther(reading: AtlasLayerReading, point: Point, except: string): number {
	return Math.min(
		...reading.markers
			.filter((entry) => entry.visible && entry.slug !== except)
			.map((entry) => Math.hypot(entry.window!.x - point.x, entry.window!.y - point.y))
	);
}

test.beforeEach(async ({ page, request }) => {
	await page.setViewportSize(DESKTOP);
	await useScenario(request, 'catalog');
});

test.afterEach(async ({ request }) => {
	await resetStub(request);
});

// Under reduced motion the globe never turns, so a full load of the atlas is at rest as soon as the
// overview has been placed.
test.describe('@webgl atlas marker gestures', () => {
	test.use({ reducedMotion: 'reduce' });

	test('draws the markers, tells a click from a drag, and opens a mountain only from a click', async ({
		page,
		probe
	}) => {
		await page.goto('/atlas');
		await expectReadyStage(page);
		await cameraAtRest(page);
		expect(await layer(page)).toMatchObject({ shown: true, layers: 1 });
		const olympus = await shown(page, OLYMPUS.slug);
		const bare = { x: olympus.window.x, y: olympus.window.y + 60 };
		expect(nearestOther(await layer(page), bare, '')).toBeGreaterThan(FINGER_REACH);

		await test.step('the pointer rings the marker under it, and nothing over bare globe', async () => {
			const cursor = () => canvas(page).evaluate((element) => getComputedStyle(element).cursor);

			const over = await onPage(page, olympus.window);
			await page.mouse.move(over.x, over.y);
			await expect.poll(cursor).toBe('pointer');
			expect((await layer(page)).hovered).toBe(OLYMPUS.slug);

			const away = await onPage(page, bare);
			await page.mouse.move(away.x, away.y);
			await expect.poll(cursor).toBe('grab');
			expect((await layer(page)).hovered).toBeUndefined();
		});

		await test.step('a click on bare globe opens nothing', async () => {
			await clickCanvas(page, bare);
			await framesPass(page, 6);

			await expect(page).toHaveURL(/\/atlas$/);
			await expect(chooser(page)).toHaveCount(0);
		});

		await test.step('a drag that starts on a marker opens nothing and turns the globe', async () => {
			const start = await onPage(page, olympus.window);

			await page.mouse.move(start.x, start.y);
			await page.mouse.down();
			await page.mouse.move(start.x + 40, start.y + 10, { steps: 8 });
			await page.mouse.up();
			await cameraAtRest(page);

			await expect(page).toHaveURL(/\/atlas$/);
			await expect(chooser(page)).toHaveCount(0);
			expect((await shown(page, OLYMPUS.slug)).window.x).toBeGreaterThan(start.x - 1);
		});

		await test.step('a click on the marker opens its mountain, and that page opens nothing from a click', async () => {
			await clickCanvas(page, (await shown(page, OLYMPUS.slug)).window);
			await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
			await expectCanonicalPose(page, OLYMPUS.camera);

			const box = (await canvas(page).boundingBox())!;
			await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
			await framesPass(page, 6);

			await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
			await expect(chooser(page)).toHaveCount(0);
			expect(await layer(page)).toMatchObject({ shown: false });
		});

		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		expect(await probe.contextsLive()).toBe(1);
	});
});
