import type { APIRequestContext, Page } from '@playwright/test';
import { ATLAS_MARKER_STYLE, markerPresentation } from '../../src/stage/globe/atlasMarkers';
import { STUB_API_URL, resetStub, useScenario } from '../ssr/support';
import {
	ACONCAGUA,
	OLYMPUS,
	atlasLayer,
	cameraAtRest,
	dragGlobe,
	expect,
	expectCanonicalPose,
	expectReadyStage,
	framesPass,
	globePosition,
	liveViewers,
	test,
	type AtlasLayerReading,
	type AtlasMarkerReading,
	type GlobePosition
} from './support/stage';

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 375, height: 740 };

const EARTH_RADIUS_METERS = 6_371_000;
// The oracle below treats the Earth as a sphere while the scene uses the WGS84 ellipsoid, whose
// radius differs by up to ~11 km; a band this wide around the spherical limb is left unasserted.
const LIMB_MARGIN_DEGREES = 4;

interface IndexEntry {
	slug: string;
	name: string;
	coordinates: { latitude: number; longitude: number };
	elevationMeters: number;
	continent: { name: string };
}

interface Canvas {
	width: number;
	height: number;
}

const list = (page: Page) => page.getByRole('region', { name: 'All mountains' });
const continent = (page: Page, name: string) =>
	list(page)
		.locator('summary')
		.filter({ hasText: new RegExp(`^${name}`) });
const item = (page: Page, name: string) => list(page).getByRole('link', { name: new RegExp(name) });
// The layout keeps open continents across visits, so a click must not close one left open.
async function openContinent(page: Page, name: string) {
	const summary = continent(page, name);
	const open = await summary.evaluate((element) => element.closest('details')?.open === true);
	if (!open) {
		await summary.click();
	}
}
const atlasLink = (page: Page) =>
	page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Atlas' });
const pauseRotation = (page: Page) => page.getByRole('button', { name: 'Pause globe rotation' });

// Every label that is up is one a reader can read; a fading one nearer the edge of its range is not.
function expectNoFaintLabels(reading: AtlasLayerReading) {
	for (const entry of reading.markers.filter((candidate) => candidate.labelShown)) {
		expect(
			markerPresentation(entry.distanceMeters).labelAlpha,
			`${entry.slug} label alpha`
		).toBeGreaterThanOrEqual(ATLAS_MARKER_STYLE.labelMinAlpha);
	}
}

// The index the atlas is rendered with comes from the stub, so the expected markers are read
// from the same answer rather than from a count written into the test.
async function servedIndex(request: APIRequestContext): Promise<IndexEntry[]> {
	const response = await request.get(`${STUB_API_URL}/api/v1/mountains`);
	return ((await response.json()) as { mountains: IndexEntry[] }).mountains;
}

async function layer(page: Page): Promise<AtlasLayerReading> {
	const current = await atlasLayer(page);
	expect(current).toBeDefined();
	return current!;
}

async function camera(page: Page): Promise<GlobePosition> {
	const current = await globePosition(page);
	expect(current).toBeDefined();
	return current!;
}

async function canvasOf(page: Page): Promise<Canvas> {
	return page
		.locator('main canvas')
		.evaluate((canvas) => ({ width: canvas.clientWidth, height: canvas.clientHeight }));
}

function marker(reading: AtlasLayerReading, slug: string): AtlasMarkerReading {
	const found = reading.markers.find((entry) => entry.slug === slug);
	expect(found, `marker ${slug}`).toBeDefined();
	return found!;
}

function visibleSlugs(reading: AtlasLayerReading): string[] {
	return reading.markers.filter((entry) => entry.visible).map((entry) => entry.slug);
}

function radians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

function angleBetweenDegrees(
	a: { latitude: number; longitude: number },
	b: { latitude: number; longitude: number }
): number {
	const cosine =
		Math.sin(radians(a.latitude)) * Math.sin(radians(b.latitude)) +
		Math.cos(radians(a.latitude)) *
			Math.cos(radians(b.latitude)) *
			Math.cos(radians(b.longitude - a.longitude));
	return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
}

/** How far from the point under the camera a summit can be and still rise above the limb. */
function limbDegrees(distanceFromCenterMeters: number, elevationMeters = 0): number {
	const camera = Math.acos(EARTH_RADIUS_METERS / distanceFromCenterMeters);
	const summit = Math.acos(EARTH_RADIUS_METERS / (EARTH_RADIUS_METERS + elevationMeters));
	return ((camera + summit) * 180) / Math.PI;
}

interface Verdict {
	violations: string[];
	hiddenBeyondLimb: number;
	visibleWithinLimb: number;
}

/**
 * Checks the layer against plain spherical geometry, independently of Cesium: a summit well past
 * the limb must be hidden, every visible marker must sit inside the canvas, and, when the whole
 * globe is framed, a summit well inside the limb must be shown.
 */
function judge(
	reading: AtlasLayerReading,
	entries: IndexEntry[],
	from: GlobePosition,
	canvas: Canvas,
	wholeGlobeInView: boolean
): Verdict {
	const violations: string[] = [];
	let hiddenBeyondLimb = 0;
	let visibleWithinLimb = 0;

	for (const entry of entries) {
		const shown = marker(reading, entry.slug);
		const angle = angleBetweenDegrees(from, entry.coordinates);
		const beyond =
			angle >
			limbDegrees(from.distanceFromCenterMeters, entry.elevationMeters) + LIMB_MARGIN_DEGREES;
		const within = angle < limbDegrees(from.distanceFromCenterMeters) - LIMB_MARGIN_DEGREES;

		if (beyond) {
			hiddenBeyondLimb += 1;
			if (shown.visible) {
				violations.push(`${entry.slug} is ${angle.toFixed(1)}° away, past the limb, yet shown`);
			}
		}
		if (within && wholeGlobeInView) {
			visibleWithinLimb += 1;
			if (!shown.visible) {
				violations.push(`${entry.slug} is ${angle.toFixed(1)}° away, inside the limb, yet hidden`);
			}
		}
		if (shown.visible) {
			const { x, y } = shown.window ?? { x: Number.NaN, y: Number.NaN };
			if (!(x >= 0 && x <= canvas.width && y >= 0 && y <= canvas.height)) {
				violations.push(`${entry.slug} is shown outside the canvas at (${x}, ${y})`);
			}
		}
	}

	return { violations, hiddenBeyondLimb, visibleWithinLimb };
}

// The layer and the camera are read a frame apart while the globe turns, so a verdict is polled.
async function expectGeometry(page: Page, entries: IndexEntry[], wholeGlobeInView: boolean) {
	let verdict: Verdict | undefined;
	await expect
		.poll(
			async () => {
				verdict = judge(
					await layer(page),
					entries,
					await camera(page),
					await canvasOf(page),
					wholeGlobeInView
				);
				return verdict.violations;
			},
			{ timeout: 15_000 }
		)
		.toEqual([]);
	return verdict!;
}

async function expectOverviewSettled(page: Page) {
	await expect.poll(async () => (await camera(page)).orbiting, { timeout: 30_000 }).toBe(true);
}

test.beforeEach(async ({ page }) => {
	await page.setViewportSize(DESKTOP);
});

test.describe('@webgl atlas markers on the catalog', () => {
	test.beforeEach(async ({ request }) => {
		await useScenario(request, 'catalog');
	});

	test.afterEach(async ({ request }) => {
		await resetStub(request);
	});

	test('draws one marker per mountain in the index, in one layer, with default depth', async ({
		page,
		request
	}) => {
		const entries = await servedIndex(request);
		await page.goto('/atlas');
		await expectReadyStage(page);

		const reading = await layer(page);
		expect(reading).toMatchObject({
			shown: true,
			layers: 1,
			entities: entries.length,
			depthTestAgainstTerrain: false
		});
		expect(reading.markers.map((entry) => entry.slug).sort()).toEqual(
			entries.map((entry) => entry.slug).sort()
		);
		// Links inside collapsed continents are in the document, though not in the accessibility tree.
		await expect(list(page).locator('a[href^="/mountains/"]')).toHaveCount(entries.length);
	});

	test('shows the facing hemisphere on the overview and hides the far one', async ({
		page,
		request
	}) => {
		const entries = await servedIndex(request);
		await page.goto('/atlas');
		await expectReadyStage(page);
		await expectOverviewSettled(page);
		await pauseRotation(page).click();
		await cameraAtRest(page);

		const verdict = await expectGeometry(page, entries, true);
		expect(verdict.hiddenBeyondLimb).toBeGreaterThan(5);
		expect(verdict.visibleWithinLimb).toBeGreaterThan(5);

		const reading = await layer(page);
		expect(marker(reading, 'aconcagua').visible).toBe(false);
		expect(marker(reading, 'mount-fuji').visible).toBe(false);
		expect(reading.markers.filter((entry) => entry.labelShown)).toEqual([]);
	});

	test('places markers where the geography puts them on screen', async ({ page }) => {
		await page.goto('/atlas');
		await expectReadyStage(page);
		await expectOverviewSettled(page);
		await pauseRotation(page).click();
		await cameraAtRest(page);

		const reading = await layer(page);
		const at = (slug: string) => {
			const shown = marker(reading, slug);
			expect(shown.visible, `${slug} visible`).toBe(true);
			return shown.window!;
		};
		// West to east, then north to south, as the overview faces Europe and Africa north up.
		expect(at('teide').x).toBeLessThan(at('toubkal').x);
		expect(at('toubkal').x).toBeLessThan(at('mont-blanc').x);
		expect(at('mont-blanc').x).toBeLessThan(at('mount-elbrus').x);
		expect(at('mount-cameroon').x).toBeLessThan(at('kilimanjaro').x);
		expect(at('mont-blanc').y).toBeLessThan(at('toubkal').y);
		expect(at('toubkal').y).toBeLessThan(at('mount-cameroon').y);
		expect(at('mount-cameroon').y).toBeLessThan(at('kilimanjaro').y);
	});

	test('moves the markers with the ambient rotation', async ({ page }) => {
		await page.goto('/atlas');
		await expectReadyStage(page);
		await expectOverviewSettled(page);
		const start = marker(await layer(page), 'mont-blanc').window!;

		// The camera drifts west, so the surface, and every marker on it, passes to the right.
		await expect
			.poll(async () => marker(await layer(page), 'mont-blanc').window!.x - start.x, {
				timeout: 30_000
			})
			.toBeGreaterThan(2);
		expect(Math.abs(marker(await layer(page), 'mont-blanc').window!.y - start.y)).toBeLessThan(5);
	});

	test('brings the far side into view, and hides the near side, when the globe is turned', async ({
		page,
		request
	}) => {
		const entries = await servedIndex(request);
		await page.goto('/atlas');
		await expectReadyStage(page);
		await expectOverviewSettled(page);
		const before = visibleSlugs(await layer(page));
		expect(before).not.toContain('aconcagua');

		await dragGlobe(page, 0.4);
		await cameraAtRest(page);

		await expectGeometry(page, entries, true);
		const after = visibleSlugs(await layer(page));
		expect(after).toContain('aconcagua');
		expect(before.filter((slug) => !after.includes(slug)).length).toBeGreaterThan(0);
	});

	test('grows markers and names them as the camera closes in, and drops the off-screen ones', async ({
		page,
		request
	}) => {
		const entries = await servedIndex(request);
		await page.goto('/atlas');
		await expectReadyStage(page);
		await expectOverviewSettled(page);
		const box = (await page.locator('main canvas').boundingBox())!;
		const far = marker(await layer(page), 'mont-blanc');
		expect(far.labelShown).toBe(false);

		// Each wheel step zooms towards the cursor, which follows Mont Blanc as it moves on screen.
		let near = far;
		for (let step = 0; step < 60 && !near.labelShown; step += 1) {
			expect(near.visible).toBe(true);
			await page.mouse.move(box.x + near.window!.x, box.y + near.window!.y);
			await page.mouse.wheel(0, -600);
			await framesPass(page, 8);
			const reading = await layer(page);
			expectNoFaintLabels(reading);
			near = marker(reading, 'mont-blanc');
		}
		await cameraAtRest(page);
		near = marker(await layer(page), 'mont-blanc');

		expect(near.labelShown).toBe(true);
		// A name shows only once its label is legible, which the overview is far from.
		expect(far.distanceMeters).toBeGreaterThan(ATLAS_MARKER_STYLE.labelMaxMeters);
		expect(markerPresentation(near.distanceMeters).labelAlpha).toBeGreaterThanOrEqual(
			ATLAS_MARKER_STYLE.labelMinAlpha
		);
		expectNoFaintLabels(await layer(page));
		expect(near.pointPixels).toBeGreaterThan(far.pointPixels);

		// Summits well above the horizon from here but far beyond the frame are not drawn.
		const from = await camera(page);
		const zoomed = await layer(page);
		const offscreen = entries.filter(
			(entry) =>
				angleBetweenDegrees(from, entry.coordinates) <
					limbDegrees(from.distanceFromCenterMeters) - LIMB_MARGIN_DEGREES &&
				!marker(zoomed, entry.slug).visible
		);
		expect(offscreen.length).toBeGreaterThan(0);
		await expectGeometry(page, entries, false);
	});

	test('draws neighbouring summits as separate markers when the camera is near, the higher one named', async ({
		page
	}) => {
		await page.goto('/atlas');
		await expectReadyStage(page);
		await expectOverviewSettled(page);
		const box = (await page.locator('main canvas').boundingBox())!;

		let blanc = marker(await layer(page), 'mont-blanc');
		for (let step = 0; step < 60 && !blanc.labelShown; step += 1) {
			expect(blanc.visible).toBe(true);
			await page.mouse.move(box.x + blanc.window!.x, box.y + blanc.window!.y);
			await page.mouse.wheel(0, -600);
			await framesPass(page, 8);
			blanc = marker(await layer(page), 'mont-blanc');
		}
		await cameraAtRest(page);

		const reading = await layer(page);
		const [mont, matterhorn] = [marker(reading, 'mont-blanc'), marker(reading, 'matterhorn')];
		expect(reading.markers.filter((entry) => entry.slug === 'matterhorn')).toHaveLength(1);
		expect([mont.visible, matterhorn.visible]).toEqual([true, true]);
		expect(mont.labelShown).toBe(true);
		// Its name may give way to Mont Blanc's while their plates overlap, but the marker stays.
		expect(matterhorn.labelShown || matterhorn.labelSuppressed).toBe(true);
		expect(
			Math.hypot(mont.window!.x - matterhorn.window!.x, mont.window!.y - matterhorn.window!.y)
		).toBeGreaterThan(1);
	});

	test('keeps visibility right through a resize of the stage', async ({ page, request }) => {
		const entries = await servedIndex(request);
		await page.goto('/atlas');
		await expectReadyStage(page);
		await expectOverviewSettled(page);
		await expectGeometry(page, entries, true);

		await page.setViewportSize(PHONE);

		await expect.poll(async () => (await canvasOf(page)).width).toBeLessThan(DESKTOP.width / 2);
		const verdict = await expectGeometry(page, entries, true);
		expect(verdict.visibleWithinLimb).toBeGreaterThan(5);
	});
});

test.describe('@webgl atlas markers across navigation', () => {
	test.afterEach(async ({ request }) => {
		await resetStub(request);
	});

	test('creates no atlas layer for a mountain page opened directly', async ({ page }) => {
		await page.goto(`/mountains/${OLYMPUS.slug}`);
		await expectReadyStage(page);
		await expectCanonicalPose(page, OLYMPUS.camera);

		expect(await layer(page)).toMatchObject({ shown: false, layers: 0, entities: 0 });
	});

	test('hides the markers on a mountain page and restores them on the way back, on one Viewer', async ({
		page,
		probe,
		request
	}) => {
		const entries = await servedIndex(request);
		await page.goto('/atlas');
		await expectReadyStage(page);
		await expect.poll(async () => visibleSlugs(await layer(page)).length).toBeGreaterThan(0);

		await openContinent(page, 'South America');
		await item(page, ACONCAGUA.name).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));

		await expect.poll(async () => (await layer(page)).shown).toBe(false);
		expect(visibleSlugs(await layer(page))).toEqual([]);
		await expectCanonicalPose(page, ACONCAGUA.camera);
		expect(await layer(page)).toMatchObject({
			shown: false,
			layers: 1,
			entities: entries.length
		});
		expect(visibleSlugs(await layer(page))).toEqual([]);

		await page.goBack();
		await expect(page).toHaveURL(/\/atlas$/);
		await expect.poll(async () => (await layer(page)).shown).toBe(true);
		await expectOverviewSettled(page);
		await expectGeometry(page, entries, true);
		expect(await layer(page)).toMatchObject({ layers: 1, entities: entries.length });

		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		expect(await probe.webglContexts()).toBe(1);
	});

	test('restores the markers when Back interrupts a mountain flight', async ({ page, request }) => {
		const entries = await servedIndex(request);
		await page.goto('/atlas');
		await expectReadyStage(page);

		await openContinent(page, 'Europe');
		await item(page, OLYMPUS.name).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await expect.poll(async () => (await layer(page)).shown).toBe(false);
		await page.goBack();

		await expect(page).toHaveURL(/\/atlas$/);
		await expectOverviewSettled(page);
		await expectGeometry(page, entries, true);
	});

	test('restores the markers when the header link interrupts a mountain flight', async ({
		page,
		request
	}) => {
		const entries = await servedIndex(request);
		await page.goto('/atlas');
		await expectReadyStage(page);
		await openContinent(page, 'South America');
		await item(page, ACONCAGUA.name).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));

		await atlasLink(page).click();
		await expect(page).toHaveURL(/\/atlas$/);
		await expect.poll(async () => (await layer(page)).shown).toBe(true);
		await expectOverviewSettled(page);
		await expectGeometry(page, entries, true);
	});

	test('builds one fresh layer on the new Viewer after a page without the stage', async ({
		page,
		request
	}) => {
		const entries = await servedIndex(request);
		await page.goto('/atlas');
		await expectReadyStage(page);
		expect((await layer(page)).layers).toBe(1);

		await page
			.getByRole('navigation', { name: 'Primary' })
			.getByRole('link', { name: 'About' })
			.click();
		await expect(page).toHaveURL(/\/about$/);
		await expect.poll(() => liveViewers(page)).toEqual({ canvases: 0, viewers: 0 });
		expect(await atlasLayer(page)).toBeUndefined();

		await atlasLink(page).click();
		await expect(page).toHaveURL(/\/atlas$/);
		await expectReadyStage(page);
		expect(await layer(page)).toMatchObject({
			shown: true,
			layers: 1,
			entities: entries.length
		});
		await expectGeometry(page, entries, true);
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
	});

	test('replaces the markers when the index changes between visits, leaving none stale', async ({
		page,
		probe,
		request
	}) => {
		await page.goto('/atlas');
		await expectReadyStage(page);
		const small = await servedIndex(request);
		expect((await layer(page)).entities).toBe(small.length);

		await openContinent(page, 'Europe');
		await item(page, OLYMPUS.name).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await useScenario(request, 'catalog');
		const large = await servedIndex(request);
		await atlasLink(page).click();
		await expect(page).toHaveURL(/\/atlas$/);

		await expect.poll(async () => (await layer(page)).entities).toBe(large.length);
		const grown = await layer(page);
		expect(grown.markers.map((entry) => entry.slug).sort()).toEqual(
			large.map((entry) => entry.slug).sort()
		);
		expect(grown.layers).toBe(1);

		await openContinent(page, 'Europe');
		await item(page, OLYMPUS.name).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await resetStub(request);
		await atlasLink(page).click();
		await expect(page).toHaveURL(/\/atlas$/);

		await expect.poll(async () => (await layer(page)).entities).toBe(small.length);
		expect((await layer(page)).markers.map((entry) => entry.slug).sort()).toEqual(
			small.map((entry) => entry.slug).sort()
		);
		await expectOverviewSettled(page);
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		expect(await probe.webglContexts()).toBe(1);
	});
});
