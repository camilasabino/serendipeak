import type { Locator, Page } from '@playwright/test';
import { fixture } from '../ssr/support';
import {
	ACONCAGUA,
	OLYMPUS,
	cameraReading,
	expect,
	expectCanonicalPose,
	expectReadyStage,
	framesPass,
	liveViewers,
	poseDifference,
	test
} from './support/stage';

const DESKTOP = { width: 1280, height: 800 };
const PERMALINK = `/mountains/${ACONCAGUA.slug}`;
const COMPASS = /^Compass\. Looking \d+ degrees \w+\.$/;

const zoomIn = (page: Page) => page.getByRole('button', { name: 'Zoom in' });
const zoomOut = (page: Page) => page.getByRole('button', { name: 'Zoom out' });
const resetButton = (page: Page) => page.getByRole('button', { name: 'Reset view' });

async function arrive(page: Page) {
	await page.setViewportSize(DESKTOP);
	await page.goto(PERMALINK);
	await expectReadyStage(page);
	await expectCanonicalPose(page, ACONCAGUA.camera);
	await expect(zoomIn(page)).toBeEnabled();
}

async function displayRange(page: Page): Promise<number> {
	return (await cameraReading(page))!.displayRangeMeters;
}

// A zoom flight is short; the range is read once it stops changing between two polls.
async function settledRange(page: Page): Promise<number> {
	let previous = Number.NaN;
	await expect
		.poll(async () => {
			const current = await displayRange(page);
			const still = Math.abs(current - previous) < 1;
			previous = current;
			return still;
		})
		.toBe(true);
	return previous;
}

// Negative evidence without a sleep: a cancelled flight that kept going would move the camera
// within these frames.
async function expectRangeHolds(page: Page, frames = 40) {
	const before = await displayRange(page);
	await framesPass(page, frames);
	expect(Math.abs((await displayRange(page)) - before)).toBeLessThan(1);
}

// Ctrl+drag rotates the view; a plain drag only pans, which leaves the heading alone.
async function rotateCamera(page: Page) {
	const box = (await page.locator('canvas').first().boundingBox())!;
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;

	await page.keyboard.down('Control');
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 220, y + 40, { steps: 12 });
	await page.mouse.up();
	await page.keyboard.up('Control');
}

async function expectMovedAway(page: Page) {
	await expect
		.poll(async () => {
			const reading = await cameraReading(page);
			return reading ? poseDifference(reading, ACONCAGUA.camera) : undefined;
		})
		.toBeDefined();
}

async function tagCanvas(page: Page) {
	await page.evaluate(() => document.querySelector('canvas')?.setAttribute('data-probe', 'first'));
}

async function centreOfCanvas(page: Page) {
	const canvas = (await page.locator('canvas').first().boundingBox())!;

	return { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
}

interface Frame {
	heading: number;
	pitch: number;
	range: number;
	framingY: number;
}

// Samples the live camera on every animation frame, so a test sees the path and not just where it
// ended. The summit's screen position moves smoothly along a straight dolly and swings if the view
// is turned, which makes it the observable stand-in for the centre-screen focus staying put.
async function startTrace(page: Page) {
	await page.evaluate(() => {
		const target = window as Window & {
			__serendipeakCamera?: () =>
				| {
						headingDegrees: number;
						pitchDegrees: number;
						displayRangeMeters: number;
						framing?: { y: number };
				  }
				| undefined;
			__trace?: Frame[];
			__traceFrame?: number;
		};
		const frames: Frame[] = [];
		target.__trace = frames;
		const sample = () => {
			const reading = target.__serendipeakCamera?.();
			if (reading) {
				frames.push({
					heading: reading.headingDegrees,
					pitch: reading.pitchDegrees,
					range: reading.displayRangeMeters,
					framingY: reading.framing?.y ?? 0
				});
			}
			target.__traceFrame = requestAnimationFrame(sample);
		};
		sample();
	});
}

async function stopTrace(page: Page): Promise<Frame[]> {
	return page.evaluate(() => {
		const target = window as Window & { __trace?: Frame[]; __traceFrame?: number };
		cancelAnimationFrame(target.__traceFrame ?? 0);
		return target.__trace ?? [];
	});
}

async function traceZoom(page: Page, button: Locator): Promise<Frame[]> {
	const before = await displayRange(page);
	await startTrace(page);
	await button.click();
	await expect.poll(() => displayRange(page)).not.toBeCloseTo(before, 0);
	await settledRange(page);
	return stopTrace(page);
}

const POSE_TOLERANCE = { angleDegrees: 0.3, framing: 0.01 };

// Every frame stays between where the zoom started and where it ended, and the distance moves one
// way only: a view that swings out and comes back leaves that envelope. How many frames a software
// renderer catches inside the flight varies, so only the frames it did catch are checked.
function expectSmoothDolly(frames: Frame[], direction: 'in' | 'out') {
	const first = frames[0]!;
	const last = frames.at(-1)!;
	const inside = (value: number, a: number, b: number, tolerance: number) =>
		value >= Math.min(a, b) - tolerance && value <= Math.max(a, b) + tolerance;

	expect(Math.abs(last.range - first.range)).toBeGreaterThan(1_000);
	for (const [index, frame] of frames.entries()) {
		const at = `frame ${index}`;
		expect(
			inside(frame.heading, first.heading, last.heading, POSE_TOLERANCE.angleDegrees),
			at
		).toBe(true);
		expect(inside(frame.pitch, first.pitch, last.pitch, POSE_TOLERANCE.angleDegrees), at).toBe(
			true
		);
		expect(inside(frame.framingY, first.framingY, last.framingY, POSE_TOLERANCE.framing), at).toBe(
			true
		);
		const previous = frames[index - 1];
		if (previous) {
			const step = frame.range - previous.range;
			expect(direction === 'out' ? step : -step, at).toBeGreaterThanOrEqual(-1);
		}
	}
}

test.describe('@webgl camera movement', () => {
	test('Reset, zoom steps and a pinch move the camera in the same Viewer', async ({
		page,
		probe
	}) => {
		await arrive(page);
		await tagCanvas(page);
		const canonical = await displayRange(page);
		const canonicalHeading = await page.getByText(COMPASS).textContent();
		const before = await cameraReading(page);

		await test.step('Reset is a no-op at the canonical pose', async () => {
			await resetButton(page).click();
			await resetButton(page).click();

			await expect(resetButton(page)).toBeEnabled();
			await expectCanonicalPose(page, ACONCAGUA.camera);
			expect(await cameraReading(page)).toEqual(before);
		});

		await test.step('zoom steps go in and out, and Reset restores the framing', async () => {
			await zoomIn(page).click();
			const closer = await settledRange(page);
			expect(closer).toBeLessThan(canonical * 0.8);

			await zoomOut(page).click();
			expect(await settledRange(page)).toBeGreaterThan(closer * 1.3);

			await resetButton(page).click();
			await expectCanonicalPose(page, ACONCAGUA.camera);
		});

		await test.step('Reset returns a rotated camera to the canonical pose and heading', async () => {
			await rotateCamera(page);

			await expectMovedAway(page);
			await expect(page.getByText(COMPASS)).not.toHaveText(canonicalHeading!);
			await resetButton(page).click();

			await expectCanonicalPose(page, ACONCAGUA.camera);
			await expect(page.getByText(COMPASS)).toHaveText(canonicalHeading!);
			await expect(resetButton(page)).toBeEnabled();
		});

		await test.step('a trackpad pinch (Ctrl + wheel) zooms the camera', async () => {
			const centre = await centreOfCanvas(page);

			await page.mouse.move(centre.x, centre.y);
			await page.keyboard.down('Control');
			for (let tick = 0; tick < 6; tick += 1) {
				await page.mouse.wheel(0, -120);
			}
			await page.keyboard.up('Control');

			await expect.poll(() => displayRange(page)).toBeLessThan(canonical * 0.95);
		});

		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		await expect(page.locator('canvas[data-probe="first"]')).toHaveCount(1);
		expect(await probe.webglContexts()).toBe(1);
	});

	test('a zoom is a smooth dolly and gives way to Reset and to the reader', async ({ page }) => {
		await arrive(page);

		await test.step('Zoom out dollies away without swinging or recentring the view', async () => {
			const frames = await traceZoom(page, zoomOut(page));

			expectSmoothDolly(frames, 'out');
			expect(frames.at(-1)!.range).toBeGreaterThan(frames[0]!.range * 1.5);
		});

		await test.step('Zoom in dollies back the same way', async () => {
			expectSmoothDolly(await traceZoom(page, zoomIn(page)), 'in');
			await resetButton(page).click();
			await expectCanonicalPose(page, ACONCAGUA.camera);
		});

		await test.step('Reset during a zoom cancels it and settles on the canonical pose', async () => {
			await zoomOut(page).click();
			await expect.poll(() => displayRange(page)).toBeGreaterThan(20_000);
			await resetButton(page).click();

			await expectCanonicalPose(page, ACONCAGUA.camera);
			await expectRangeHolds(page);
			await expectCanonicalPose(page, ACONCAGUA.camera);
		});

		await test.step('the reader taking the camera mid-zoom cancels it instead of fighting back', async () => {
			const centre = await centreOfCanvas(page);

			await zoomOut(page).click();
			await expect.poll(() => displayRange(page)).toBeGreaterThan(20_000);
			await page.mouse.move(centre.x, centre.y);
			for (let tick = 0; tick < 8; tick += 1) {
				await page.mouse.wheel(0, -120);
			}
			const taken = await settledRange(page);

			await expectRangeHolds(page);
			expect(taken).toBeLessThan(40_000);
		});
	});
});

test.describe('@webgl camera under reduced motion', () => {
	test('zoom, Reset and Explore work by keyboard and land without intermediate poses', async ({
		page
	}) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.route('**/api/v1/mountains/random**', (route) =>
			route.fulfill({
				json: fixture<unknown>('mountain-sparse.json'),
				headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }
			})
		);
		await arrive(page);
		const canonical = await displayRange(page);

		await test.step('the zoom buttons step instantly and are keyboard operable', async () => {
			await zoomIn(page).focus();
			await page.keyboard.press('Enter');
			await expect.poll(() => displayRange(page)).toBeLessThan(canonical * 0.8);
			await expect(zoomIn(page)).toBeFocused();

			await page.keyboard.press('Tab');
			await expect(zoomOut(page)).toBeFocused();
			await page.keyboard.press('Space');
			await expect.poll(() => displayRange(page)).toBeGreaterThan(canonical * 0.9);
		});

		await test.step('a step lands in one frame, with no pose in between', async () => {
			const frames = await traceZoom(page, zoomOut(page));

			const distinct = new Set(frames.map((frame) => Math.round(frame.range)));
			expect(distinct.size).toBe(2);
		});

		await test.step('Reset by keyboard reaches the canonical pose and keeps focus', async () => {
			await rotateCamera(page);
			await expectMovedAway(page);

			await resetButton(page).focus();
			await page.keyboard.press('Enter');

			await expectCanonicalPose(page, ACONCAGUA.camera);
			await expect(resetButton(page)).toBeFocused();
		});

		await test.step('Explore reaches the destination state without a flight', async () => {
			await page.getByRole('button', { name: /^Explore another/ }).click();

			await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
			await expectCanonicalPose(page, OLYMPUS.camera);
			await expect(page.getByRole('button', { name: /^Explore another/ })).toHaveAttribute(
				'aria-busy',
				'false'
			);
			expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		});
	});
});
