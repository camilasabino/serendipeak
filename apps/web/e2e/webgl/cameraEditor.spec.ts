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
const ADMIN_PATH = `/admin/catalog/mountainrecord/${TARGET.id}`;

// What the Admin confirmation receives. The saved precision is coarser than a reading, so the
// legacy tolerances for a rendered canonical pose apply; they are tighter than the precision.
const SAVE_TOLERANCE = { angleDegrees: 0.05, rangeMeters: 1, framing: 0.0005 } as const;

function editorUrl(camera?: CanonicalCamera): string {
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

// Stands in for the Admin: the editor only ever navigates there, and the test reads where.
async function interceptAdmin(page: Page): Promise<() => URL | undefined> {
	let reached: URL | undefined;
	await page.route(`${STUB_API_URL}${ADMIN_PATH}/**`, async (route) => {
		reached = new URL(route.request().url());
		await route.fulfill({
			contentType: 'text/html',
			body: '<title>Admin</title><p>confirmation</p>'
		});
	});

	return () => reached;
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

function expectSaved(url: URL, reading: NonNullable<Awaited<ReturnType<typeof cameraReading>>>) {
	const value = (name: string) => Number(url.searchParams.get(name));
	const angle = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

	expect(angle(value('heading'), reading.headingDegrees)).toBeLessThanOrEqual(
		SAVE_TOLERANCE.angleDegrees
	);
	expect(Math.abs(value('pitch') - reading.pitchDegrees)).toBeLessThanOrEqual(
		SAVE_TOLERANCE.angleDegrees
	);
	expect(Math.abs(value('range') - reading.rangeMeters)).toBeLessThanOrEqual(
		SAVE_TOLERANCE.rangeMeters
	);
	expect(Math.abs(value('fx') - reading.framing!.x)).toBeLessThanOrEqual(SAVE_TOLERANCE.framing);
	expect(Math.abs(value('fy') - reading.framing!.y)).toBeLessThanOrEqual(SAVE_TOLERANCE.framing);
}

test.describe('@webgl camera editor', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize(DESKTOP);
	});

	test('opens on the stored camera and shows it as it would be saved', async ({ page }) => {
		await page.goto(editorUrl(ACONCAGUA.camera));
		await expectReadyStage(page);

		await expectCanonicalPose(page, ACONCAGUA.camera);
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

	test('saves by navigating to the Admin with the quantized live camera', async ({ page }) => {
		const reached = await interceptAdmin(page);
		await page.goto(editorUrl(ACONCAGUA.camera));
		await expectReadyStage(page);
		await expectCanonicalPose(page, ACONCAGUA.camera);
		await orbit(page);
		await untilStill(page);
		const reading = (await cameraReading(page))!;

		await page.getByRole('button', { name: 'Save camera…' }).click();

		await expect.poll(() => reached()?.pathname).toBe(`${ADMIN_PATH}/camera/`);
		const url = reached()!;
		expect(url.origin).toBe(STUB_API_URL);
		expectSaved(url, reading);
		expect([...url.searchParams.keys()].sort()).toEqual(['fx', 'fy', 'heading', 'pitch', 'range']);
		// The editor wrote nothing: the Admin form is what saves.
		await expect(page.getByText('confirmation')).toBeVisible();
	});

	test('reopening on the saved values reproduces the same view', async ({ page }) => {
		const reached = await interceptAdmin(page);
		await page.goto(editorUrl(ACONCAGUA.camera));
		await expectReadyStage(page);
		await expectCanonicalPose(page, ACONCAGUA.camera);
		await orbit(page);
		await untilStill(page);
		await page.getByRole('button', { name: 'Save camera…' }).click();
		await expect.poll(() => reached()?.pathname).toBe(`${ADMIN_PATH}/camera/`);
		const saved = reached()!.searchParams;
		const camera: CanonicalCamera = {
			headingDegrees: Number(saved.get('heading')),
			pitchDegrees: Number(saved.get('pitch')),
			rangeMeters: Number(saved.get('range')),
			framing: { x: Number(saved.get('fx')), y: Number(saved.get('fy')) }
		};

		await page.goto(editorUrl(camera));
		await expectReadyStage(page);

		await expectCanonicalPose(page, camera);
		await expect(readout(page, 'Heading')).toHaveText(`${camera.headingDegrees}°`);
		await expect(readout(page, 'Range')).toHaveText(`${camera.rangeMeters} m`);
	});

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

	test('goes back to the mountain in the Admin without saving anything', async ({ page }) => {
		const reached = await interceptAdmin(page);
		await page.goto(editorUrl(ACONCAGUA.camera));
		await expectReadyStage(page);

		await page.getByRole('link', { name: 'Back to the mountain' }).click();

		await expect.poll(() => reached()?.pathname).toBe(`${ADMIN_PATH}/change/`);
		expect(reached()!.search).toBe('');
	});

	test('refuses an invalid link without starting a globe', async ({ page }) => {
		await page.goto('/editorial/camera?mountain=not-a-uuid');

		await expect(page.locator('main [role="alert"]')).toContainText('Open the camera editor again');
		await expect(page.locator('canvas')).toHaveCount(0);
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
	});
});
