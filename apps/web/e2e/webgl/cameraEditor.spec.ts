import type { Page } from '@playwright/test';
import { STUB_API_URL, fixture } from '../ssr/support';
import {
	CAMERA_TOLERANCE,
	ACONCAGUA,
	cameraReading,
	expect,
	expectCanonicalPose,
	test,
	type CanonicalCamera
} from './support/stage';

interface ContractTarget {
	id: string;
	coordinates: { latitude: number; longitude: number };
	elevationMeters: number;
}

const TARGET = fixture<ContractTarget>('mountain-complete.json');
const DESKTOP = { width: 1280, height: 800 };
const STUDIO_PATH = `/studio/mountains/${ACONCAGUA.slug}`;

// The legacy tolerances for a saved camera: the reading of a view opened on a camera, and the
// values saved from it, must agree with that camera this closely. They are tighter than the
// 0.5 degree, 0.5 percent and 0.01 that a rendered public pose is held to.
const SAVE_TOLERANCE = { angleDegrees: 0.05, rangeMeters: 1, framing: 0.0005 } as const;

// The narrowest stage aspect the editor frames, where the range scale already sits at its 0.85
// floor; a wider workspace is filled.
const MIN_FILL_ASPECT = 1.35 / 0.85;
const REFERENCE_RANGE_SCALE = 0.85;

// Viewports from a phone to an ultrawide screen: the editor frames the same range on all.
const SCREENS = [
	{ name: 'laptop', width: 1280, height: 800 },
	{ name: 'full HD', width: 1920, height: 1080 },
	{ name: 'ultrawide', width: 3440, height: 1440 },
	{ name: 'tablet portrait', width: 768, height: 1024 },
	{ name: 'phone', width: 390, height: 844 },
	{ name: 'phone landscape', width: 844, height: 390 }
] as const;

type Reading = NonNullable<Awaited<ReturnType<typeof cameraReading>>>;

function editorUrl(camera?: CanonicalCamera, { proposal = false } = {}): string {
	const query = new URLSearchParams({
		mountain: TARGET.id,
		slug: ACONCAGUA.slug,
		name: ACONCAGUA.name,
		lat: String(TARGET.coordinates.latitude),
		lon: String(TARGET.coordinates.longitude),
		elevation: String(TARGET.elevationMeters)
	});
	if (camera) {
		query.set('heading', String(camera.headingDegrees));
		query.set('pitch', String(camera.pitchDegrees));
		query.set('range', String(camera.rangeMeters));
		query.set('fx', String(camera.framing?.x));
		query.set('fy', String(camera.framing?.y));
		if (proposal) {
			query.set('proposal', '1');
		}
	}

	return `/editorial/camera?${query}`;
}

const readout = (page: Page, label: string) =>
	page.getByLabel('Live camera').locator('div', { hasText: label }).locator('dd');

// The panel's own status region is never empty, so the shared readiness helper does not fit: the
// stage is ready once the reveal loader is gone and nothing failed.
async function expectReadyStage(page: Page) {
	await expect(page.getByText('Revealing the mountain...')).toHaveCount(0, { timeout: 60_000 });
	await expect(page.locator('main [role="alert"]')).toHaveCount(0);
	await expect(page.getByText('Ready to save.')).toBeVisible({ timeout: 60_000 });
}

// Stands in for the Studio: the editor only ever navigates there, and the test reads where.
async function interceptStudio(page: Page): Promise<{ (): URL | undefined; all(): URL[] }> {
	const requests: { url: URL; method: string }[] = [];
	await page.route(`${STUB_API_URL}${STUDIO_PATH}/**`, async (route) => {
		requests.push({ url: new URL(route.request().url()), method: route.request().method() });
		await route.fulfill({
			contentType: 'text/html',
			body: '<title>Studio</title><p>confirmation</p>'
		});
	});
	const reached = () => requests.at(-1)?.url;
	// The editor writes nothing, so everything it sends the Studio is a read.
	reached.all = () => {
		expect(requests.map(({ method }) => method)).toEqual(requests.map(() => 'GET'));
		return requests.map(({ url }) => url);
	};

	return reached;
}

// Heading is circular, so it is compared around the wrap.
function angleDelta(a: number, b: number): number {
	return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

function expectWithin(
	actual: {
		headingDegrees: number;
		pitchDegrees: number;
		rangeMeters: number;
		framing?: { x: number; y: number };
	},
	expected: CanonicalCamera
) {
	expect(angleDelta(actual.headingDegrees, expected.headingDegrees)).toBeLessThanOrEqual(
		SAVE_TOLERANCE.angleDegrees
	);
	expect(Math.abs(actual.pitchDegrees - expected.pitchDegrees)).toBeLessThanOrEqual(
		SAVE_TOLERANCE.angleDegrees
	);
	expect(Math.abs(actual.rangeMeters - expected.rangeMeters)).toBeLessThanOrEqual(
		SAVE_TOLERANCE.rangeMeters
	);
	expect(Math.abs(actual.framing!.x - expected.framing!.x)).toBeLessThanOrEqual(
		SAVE_TOLERANCE.framing
	);
	expect(Math.abs(actual.framing!.y - expected.framing!.y)).toBeLessThanOrEqual(
		SAVE_TOLERANCE.framing
	);
}

function savedCamera(url: URL): CanonicalCamera {
	const value = (name: string) => Number(url.searchParams.get(name));

	return {
		headingDegrees: value('heading'),
		pitchDegrees: value('pitch'),
		rangeMeters: value('range'),
		framing: { x: value('fx'), y: value('fy') }
	};
}

// Ctrl+drag rotates the view; a plain drag only pans.
async function orbit(page: Page) {
	const box = (await page.locator('canvas').first().boundingBox())!;
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.keyboard.down('Control');
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 120, y + 20, { steps: 10 });
	await page.mouse.up();
	await page.keyboard.up('Control');
}

// Inertia keeps the camera moving after the pointer is released.
async function untilStill(page: Page) {
	let previous = '';
	await expect
		.poll(async () => {
			const current = JSON.stringify(await cameraReading(page));
			const still = current === previous;
			previous = current;
			return still;
		})
		.toBe(true);
}

function expectSaved(url: URL, reading: Reading) {
	expectWithin(savedCamera(url), reading as CanonicalCamera);
}

test.describe('@webgl camera editor', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize(DESKTOP);
	});

	test('opens on the stored camera and shows it as it would be saved', async ({ page }) => {
		await page.goto(editorUrl(ACONCAGUA.camera));
		await expectReadyStage(page);

		await expectCanonicalPose(page, ACONCAGUA.camera);
		await untilStill(page);
		expectWithin((await cameraReading(page))!, ACONCAGUA.camera);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(ACONCAGUA.name);
		await expect(page.getByText('Opened on the saved camera.')).toBeVisible();
		await expect(page.getByText('Ready to save.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Save camera…' })).toBeEnabled();
		await expect(readout(page, 'Heading')).toHaveText(/^\d+(\.\d{1,2})?°$/);
		expect(
			Math.abs(Number.parseFloat((await readout(page, 'Heading').textContent())!) - 66.87)
		).toBeLessThanOrEqual(CAMERA_TOLERANCE.angleDegrees);
	});

	test('follows the camera while it moves', async ({ page }) => {
		await page.goto(editorUrl(ACONCAGUA.camera));
		await expectReadyStage(page);
		await expectCanonicalPose(page, ACONCAGUA.camera);
		const before = await readout(page, 'Heading').textContent();

		await orbit(page);

		await expect(readout(page, 'Heading')).not.toHaveText(before!);
	});

	test('saves by navigating to the Studio with the quantized live camera', async ({ page }) => {
		const reached = await interceptStudio(page);
		await page.goto(editorUrl(ACONCAGUA.camera));
		await expectReadyStage(page);
		await expectCanonicalPose(page, ACONCAGUA.camera);
		await orbit(page);
		await untilStill(page);
		const reading = (await cameraReading(page))!;

		await page.getByRole('button', { name: 'Save camera…' }).click();

		await expect.poll(() => reached()?.pathname).toBe(`${STUDIO_PATH}/camera/`);
		const url = reached()!;
		expect(url.origin).toBe(STUB_API_URL);
		expectSaved(url, reading);
		expect([...url.searchParams.keys()].sort()).toEqual([
			'fx',
			'fy',
			'heading',
			'lat',
			'lon',
			'mountain',
			'pitch',
			'range'
		]);
		expect(url.searchParams.get('mountain')).toBe(TARGET.id);
		expect(Number(url.searchParams.get('lat'))).toBe(TARGET.coordinates.latitude);
		expect(Number(url.searchParams.get('lon'))).toBe(TARGET.coordinates.longitude);
		// The editor wrote nothing: the Studio form is what saves.
		await expect(page.getByText('confirmation')).toBeVisible();
	});

	test('reopening on the saved values reproduces the same view', async ({ page }) => {
		const reached = await interceptStudio(page);
		await page.goto(editorUrl(ACONCAGUA.camera));
		await expectReadyStage(page);
		await expectCanonicalPose(page, ACONCAGUA.camera);
		await orbit(page);
		await untilStill(page);
		const beforeSaving = (await cameraReading(page))!;
		await page.getByRole('button', { name: 'Save camera…' }).click();
		await expect.poll(() => reached()?.pathname).toBe(`${STUDIO_PATH}/camera/`);
		const camera = savedCamera(reached()!);

		await page.goto(editorUrl(camera));
		await expectReadyStage(page);

		await expectCanonicalPose(page, camera);
		await untilStill(page);
		const reopened = (await cameraReading(page))!;
		expectWithin(reopened, camera);
		// The whole cycle, from the view the editor left to the view it reopens on.
		expectWithin(reopened, beforeSaving as CanonicalCamera);
		await expect(readout(page, 'Heading')).toHaveText(`${camera.headingDegrees}°`);
		await expect(readout(page, 'Range')).toHaveText(`${camera.rangeMeters} m`);
	});

	test('saving without moving keeps the stored camera', async ({ page }) => {
		const reached = await interceptStudio(page);
		await page.goto(editorUrl(ACONCAGUA.camera));
		await expectReadyStage(page);
		await expectCanonicalPose(page, ACONCAGUA.camera);
		await untilStill(page);

		await page.getByRole('button', { name: 'Save camera…' }).click();

		await expect.poll(() => reached()?.pathname).toBe(`${STUDIO_PATH}/camera/`);
		expectWithin(savedCamera(reached()!), ACONCAGUA.camera);
	});

	test('a double click on Save only reads the Studio confirmation, twice at most', async ({
		page
	}) => {
		const reached = await interceptStudio(page);
		await page.goto(editorUrl(ACONCAGUA.camera));
		await expectReadyStage(page);
		await expectCanonicalPose(page, ACONCAGUA.camera);
		await untilStill(page);

		await page.getByRole('button', { name: 'Save camera…' }).dblclick();

		await expect.poll(() => reached()?.pathname).toBe(`${STUDIO_PATH}/camera/`);
		await expect(page.getByText('confirmation')).toBeVisible();
		const urls = reached.all().map(String);
		expect(urls.length).toBeLessThanOrEqual(2);
		expect(new Set(urls).size).toBe(1);
	});

	test('does not save a pose that is still returning to the presented camera', async ({ page }) => {
		const reached = await interceptStudio(page);
		await page.goto(editorUrl(ACONCAGUA.camera));
		await expectReadyStage(page);
		await expectCanonicalPose(page, ACONCAGUA.camera);
		await orbit(page);
		await untilStill(page);

		// One task: the panel has not sampled the flight yet, so Save is still enabled when clicked.
		await page.evaluate(() => {
			const button = (name: string) =>
				[...document.querySelectorAll('button')].find((b) => b.textContent === name)!;
			button('Restore saved camera').click();
			button('Save camera…').click();
		});

		await expectCanonicalPose(page, ACONCAGUA.camera);
		await expect(page.getByText('Ready to save.')).toBeVisible();
		expect(reached()).toBeUndefined();
		expect(new URL(page.url()).pathname).toBe('/editorial/camera');

		await page.getByRole('button', { name: 'Save camera…' }).click();
		await expect.poll(() => reached()?.pathname).toBe(`${STUDIO_PATH}/camera/`);
	});

	test('opens on a proposal sent back by the Studio and says it is not saved', async ({ page }) => {
		await page.goto(editorUrl(ACONCAGUA.camera, { proposal: true }));
		await expectReadyStage(page);

		await expectCanonicalPose(page, ACONCAGUA.camera);
		await untilStill(page);
		expectWithin((await cameraReading(page))!, ACONCAGUA.camera);
		await expect(
			page.getByText('Opened on the camera you proposed. It is not saved yet.')
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'Restore proposed camera' })).toBeEnabled();
	});

	for (const screen of SCREENS) {
		test(`frames the stage at the reference range on a ${screen.name} screen`, async ({ page }) => {
			await page.setViewportSize(screen);
			await page.goto(editorUrl(ACONCAGUA.camera));
			await expectReadyStage(page);
			await expectCanonicalPose(page, ACONCAGUA.camera);
			await untilStill(page);

			const reading = (await cameraReading(page))!;
			const aspect = reading.stage.width / reading.stage.height;
			expect(aspect).toBeGreaterThanOrEqual(MIN_FILL_ASPECT - 0.01);
			// The displayed range is the saved range times the public page's own scale at this aspect.
			expect(
				Math.abs(reading.displayRangeMeters / reading.rangeMeters - REFERENCE_RANGE_SCALE)
			).toBeLessThanOrEqual(0.01);
			expectWithin(reading, ACONCAGUA.camera);
			const box = (await page.locator('canvas').first().boundingBox())!;
			expect(box.width).toBeLessThanOrEqual(screen.width);
			await expect(page.getByRole('button', { name: 'Save camera…' })).toBeEnabled();
		});
	}

	test('restores the presented camera after the view was moved', async ({ page }) => {
		await page.goto(editorUrl(ACONCAGUA.camera));
		await expectReadyStage(page);
		await expectCanonicalPose(page, ACONCAGUA.camera);
		await orbit(page);
		await untilStill(page);

		await page.getByRole('button', { name: 'Restore saved camera' }).click();

		await expectCanonicalPose(page, ACONCAGUA.camera);
		await expect(page.getByText('Ready to save.')).toBeVisible();
	});

	test('starts from the automatic view when nothing is saved', async ({ page }) => {
		await page.goto(editorUrl());
		await expectReadyStage(page);

		await expect(page.getByText(/No saved camera yet/)).toBeVisible();
		await expect(page.getByRole('button', { name: 'Restore automatic view' })).toBeEnabled();
		await expect.poll(async () => (await cameraReading(page))?.framing).toBeDefined();
	});

	test('goes back to the mountain in the Studio without saving anything', async ({ page }) => {
		const reached = await interceptStudio(page);
		await page.goto(editorUrl(ACONCAGUA.camera));
		await expectReadyStage(page);

		await page.getByRole('link', { name: 'Back to the mountain' }).click();

		await expect.poll(() => reached()?.pathname).toBe(`${STUDIO_PATH}/`);
		expect(reached()!.search).toBe('');
	});

	test('refuses an invalid link without starting a globe', async ({ page }) => {
		await page.goto('/editorial/camera?mountain=not-a-uuid');

		await expect(page.locator('main [role="alert"]')).toContainText('Open the camera editor again');
		await expect(page.locator('canvas')).toHaveCount(0);
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
	});
});
