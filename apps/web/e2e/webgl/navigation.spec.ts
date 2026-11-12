import type { Locator, Page } from '@playwright/test';
import { fixture } from '../ssr/support';
import {
	ACONCAGUA,
	OLYMPUS,
	cameraReading,
	expect,
	expectCanonicalPose,
	expectReadyStage,
	liveViewers,
	test
} from './support/stage';

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 375, height: 667 };
const PERMALINK = `/mountains/${ACONCAGUA.slug}`;

const zoomIn = (page: Page) => page.getByRole('button', { name: 'Zoom in' });
const zoomOut = (page: Page) => page.getByRole('button', { name: 'Zoom out' });
const helpTrigger = (page: Page) => page.getByRole('button', { name: 'How to navigate' });
const helpPanel = (page: Page) => page.getByRole('dialog', { name: 'How to navigate' });

async function arrive(page: Page) {
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
// way only: a view that swings out and comes back leaves that envelope.
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

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
	return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function box(locator: Locator) {
	const found = await locator.boundingBox();
	expect(found).not.toBeNull();
	return found!;
}

test.describe('@webgl zoom controls', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize(DESKTOP);
	});

	test('step the camera in and out in the same viewer, and Reset restores the framing', async ({
		page,
		probe
	}) => {
		await arrive(page);
		const canonical = await displayRange(page);

		await zoomIn(page).click();
		const closer = await settledRange(page);
		expect(closer).toBeLessThan(canonical * 0.8);

		await zoomOut(page).click();
		const back = await settledRange(page);
		expect(back).toBeGreaterThan(closer * 1.3);

		await page.getByRole('button', { name: 'Reset view' }).click();
		await expectCanonicalPose(page, ACONCAGUA.camera);
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		expect(await probe.webglContexts()).toBe(1);
	});

	test('Zoom out is a smooth dolly: the view is not swung or recentred on the way', async ({
		page
	}) => {
		await arrive(page);

		const frames = await traceZoom(page, zoomOut(page));

		// How many frames a software renderer manages inside the 0.5 s flight varies from run to run,
		// so the test checks every frame it did catch and where the dolly ends, never how many there were.
		// Frame-by-frame interpolation is pinned deterministically in ViewerCameraFlight.zoom.spec.ts.
		expectSmoothDolly(frames, 'out');
		expect(frames.at(-1)!.range).toBeGreaterThan(frames[0]!.range * 1.5);
	});

	test('repeated Zoom out then Zoom in stays smooth and returns to where it began', async ({
		page
	}) => {
		await arrive(page);
		const start = await displayRange(page);
		const ranges = [start];

		for (const button of [zoomOut, zoomOut, zoomOut]) {
			expectSmoothDolly(await traceZoom(page, button(page)), 'out');
			ranges.push(await displayRange(page));
		}
		for (const button of [zoomIn, zoomIn, zoomIn]) {
			expectSmoothDolly(await traceZoom(page, button(page)), 'in');
			ranges.push(await displayRange(page));
		}

		expect(ranges.slice(0, 4)).toEqual([...ranges.slice(0, 4)].sort((a, b) => a - b));
		expect(Math.abs(ranges.at(-1)! - start) / start).toBeLessThan(0.01);
	});

	test('Zoom in is a smooth dolly too', async ({ page }) => {
		await arrive(page);

		expectSmoothDolly(await traceZoom(page, zoomIn(page)), 'in');
	});

	test('under reduced motion a step lands in one frame without intermediate poses', async ({
		page
	}) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await arrive(page);
		const frames = await traceZoom(page, zoomOut(page));

		const distinct = new Set(frames.map((frame) => Math.round(frame.range)));
		expect(distinct.size).toBe(2);
	});

	test('Reset View during a zoom cancels it and settles on the canonical pose', async ({
		page
	}) => {
		await arrive(page);

		await zoomOut(page).click();
		await expect.poll(() => displayRange(page)).toBeGreaterThan(20_000);
		await page.getByRole('button', { name: 'Reset view' }).click();

		await expectCanonicalPose(page, ACONCAGUA.camera);
		const settled = await displayRange(page);
		await page.waitForTimeout(1_000);
		expect(await displayRange(page)).toBeCloseTo(settled, 0);
		await expectCanonicalPose(page, ACONCAGUA.camera);
	});

	test('a scene transition during a zoom cancels it and arrives on the new mountain', async ({
		page,
		probe
	}) => {
		await page.route('**/api/v1/mountains/random**', (route) =>
			route.fulfill({
				json: fixture<unknown>('mountain-sparse.json'),
				headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }
			})
		);
		await arrive(page);

		await zoomOut(page).click();
		await page.getByRole('button', { name: /^Explore another/ }).click();

		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`), { timeout: 60_000 });
		await expectCanonicalPose(page, OLYMPUS.camera);
		const settled = await displayRange(page);
		await page.waitForTimeout(1_000);
		expect(await displayRange(page)).toBeCloseTo(settled, 0);
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		expect(await probe.webglContexts()).toBe(1);
	});

	test('the user taking the camera mid-zoom cancels it instead of fighting back', async ({
		page
	}) => {
		await arrive(page);
		const canvas = await box(page.locator('canvas').first());
		const centre = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };

		await zoomOut(page).click();
		await expect.poll(() => displayRange(page)).toBeGreaterThan(20_000);
		await page.mouse.move(centre.x, centre.y);
		for (let tick = 0; tick < 8; tick += 1) {
			await page.mouse.wheel(0, -120);
		}
		const taken = await settledRange(page);

		await page.waitForTimeout(1_000);
		expect(Math.abs((await displayRange(page)) - taken)).toBeLessThan(1);
		expect(taken).toBeLessThan(40_000);
	});

	test('repeated Zoom in stops short of the terrain', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await arrive(page);

		for (let step = 0; step < 12; step += 1) {
			await zoomIn(page).click();
		}

		const closest = await settledRange(page);
		expect(closest).toBeGreaterThan(0);

		await zoomIn(page).click();
		expect(Math.abs((await settledRange(page)) - closest)).toBeLessThan(1);
		await expect(zoomIn(page)).toBeEnabled();
		await expect(page.locator('main [role="alert"]')).toHaveCount(0);
	});

	test('are keyboard operable and step instantly under reduced motion', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await arrive(page);
		const canonical = await displayRange(page);

		await zoomIn(page).focus();
		await page.keyboard.press('Enter');
		await expect.poll(() => displayRange(page)).toBeLessThan(canonical * 0.8);
		await expect(zoomIn(page)).toBeFocused();

		await page.keyboard.press('Tab');
		await expect(zoomOut(page)).toBeFocused();
		await page.keyboard.press('Space');
		await expect.poll(() => displayRange(page)).toBeGreaterThan(canonical * 0.9);
	});

	test('a trackpad pinch (Ctrl + wheel) zooms the camera', async ({ page }) => {
		await arrive(page);
		const canonical = await displayRange(page);
		const canvas = await box(page.locator('canvas').first());

		await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
		await page.keyboard.down('Control');
		for (let tick = 0; tick < 6; tick += 1) {
			await page.mouse.wheel(0, -120);
		}
		await page.keyboard.up('Control');

		await expect.poll(() => displayRange(page)).toBeLessThan(canonical * 0.95);
	});
});

test.describe('@webgl navigation help', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize(DESKTOP);
	});

	test('opens as a labelled dialog that takes focus and closes on Escape', async ({ page }) => {
		await arrive(page);
		await expect(helpPanel(page)).toBeHidden();

		await helpTrigger(page).click();

		await expect(helpPanel(page)).toBeVisible();
		await expect(helpTrigger(page)).toHaveAttribute('aria-expanded', 'true');
		await expect(helpPanel(page)).toBeFocused();
		await expect(helpPanel(page).getByRole('heading', { level: 3 })).toHaveText([
			'Mouse and trackpad',
			'Touch',
			'Buttons'
		]);

		await page.keyboard.press('Escape');

		await expect(helpPanel(page)).toBeHidden();
		await expect(helpTrigger(page)).toHaveAttribute('aria-expanded', 'false');
		await expect(helpTrigger(page)).toBeFocused();
	});

	test('closes from its Close button and from the trigger, returning focus', async ({ page }) => {
		await arrive(page);

		await helpTrigger(page).focus();
		await page.keyboard.press('Enter');
		await expect(helpPanel(page)).toBeVisible();
		await page.getByRole('button', { name: 'Close navigation help' }).click();
		await expect(helpPanel(page)).toBeHidden();
		await expect(helpTrigger(page)).toBeFocused();

		await helpTrigger(page).click();
		await expect(helpPanel(page)).toBeVisible();
		await helpTrigger(page).click();
		await expect(helpPanel(page)).toBeHidden();
	});

	test('gets out of the way as soon as the globe is used', async ({ page }) => {
		await arrive(page);
		await helpTrigger(page).click();
		await expect(helpPanel(page)).toBeVisible();
		const canvas = await box(page.locator('canvas').first());

		await page.mouse.move(canvas.x + canvas.width * 0.75, canvas.y + canvas.height * 0.75);
		await page.mouse.down();
		await page.mouse.up();

		await expect(helpPanel(page)).toBeHidden();
		await expect(zoomIn(page)).toBeEnabled();
	});

	test('stays inside the stage and usable in fullscreen', async ({ page }) => {
		await arrive(page);
		await page.getByRole('button', { name: 'Enter fullscreen' }).click();
		await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe('DIV');

		await helpTrigger(page).click();

		await expect(helpPanel(page)).toBeVisible();
		expect(
			await helpPanel(page).evaluate((panel) => document.fullscreenElement?.contains(panel))
		).toBe(true);
		const panel = await box(helpPanel(page));
		expect(panel.y + panel.height).toBeLessThanOrEqual(DESKTOP.height);
		expect(panel.x + panel.width).toBeLessThanOrEqual(DESKTOP.width);
	});
});

test.describe('@webgl navigation on a phone', () => {
	test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

	test('keeps every stage control apart and tappable', async ({ page }) => {
		await arrive(page);
		const stage = await box(page.locator('[data-stage]'));
		const buttons = [
			zoomIn(page),
			zoomOut(page),
			helpTrigger(page),
			page.getByRole('button', { name: 'Reset view' })
		];
		const boxes = await Promise.all(buttons.map(box));
		const compass = await box(page.getByText(/^Compass\./).locator('xpath=..'));

		for (const [index, current] of boxes.entries()) {
			expect(current.width).toBeGreaterThanOrEqual(44);
			expect(current.height).toBeGreaterThanOrEqual(44);
			expect(current.y + current.height).toBeLessThanOrEqual(stage.y + stage.height);
			expect(overlaps(current, compass), `button ${index} and compass`).toBe(false);
			for (const other of boxes.slice(index + 1)) {
				expect(overlaps(current, other)).toBe(false);
			}
		}

		const canonical = await displayRange(page);
		await zoomIn(page).tap();
		await expect.poll(() => displayRange(page)).toBeLessThan(canonical * 0.8);
	});

	test('lists touch gestures first and fits the help in the stage', async ({ page }) => {
		await arrive(page);
		const stage = await box(page.locator('[data-stage]'));

		await helpTrigger(page).tap();

		await expect(helpPanel(page)).toBeVisible();
		await expect(helpPanel(page).getByRole('heading', { level: 3 }).first()).toHaveText('Touch');
		const panel = await box(helpPanel(page));
		expect(panel.x).toBeGreaterThanOrEqual(stage.x);
		expect(panel.x + panel.width).toBeLessThanOrEqual(stage.x + stage.width);
		expect(panel.y + panel.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
	});
});
