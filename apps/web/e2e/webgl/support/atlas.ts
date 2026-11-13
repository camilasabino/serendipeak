import type { APIRequestContext, Page } from '@playwright/test';
import { ATLAS_MARKER_STYLE, markerPresentation } from '../../../src/stage/globe/atlasMarkers';
import { STUB_API_URL } from '../../ssr/support';
import {
	atlasLayer,
	expect,
	globePosition,
	type AtlasLayerReading,
	type AtlasMarkerReading,
	type GlobePosition
} from './stage';

const EARTH_RADIUS_METERS = 6_371_000;
// The oracle below treats the Earth as a sphere while the scene uses the WGS84 ellipsoid, whose
// radius differs by up to ~11 km; a band this wide around the spherical limb is left unasserted.
export const LIMB_MARGIN_DEGREES = 4;

export interface IndexEntry {
	slug: string;
	name: string;
	coordinates: { latitude: number; longitude: number };
	elevationMeters: number;
	continent: { name: string };
}

export interface Canvas {
	width: number;
	height: number;
}

export const list = (page: Page) => page.getByRole('region', { name: 'All mountains' });
export const continent = (page: Page, name: string) =>
	list(page)
		.locator('summary')
		.filter({ hasText: new RegExp(`^${name}`) });
export const item = (page: Page, name: string) =>
	list(page).getByRole('link', { name: new RegExp(name) });
// The layout keeps open continents across visits, so a click must not close one left open.
export async function openContinent(page: Page, name: string) {
	const summary = continent(page, name);
	const open = await summary.evaluate((element) => element.closest('details')?.open === true);
	if (!open) {
		await summary.click();
	}
}
export const atlasLink = (page: Page) =>
	page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Atlas' });
export const pauseRotation = (page: Page) =>
	page.getByRole('button', { name: 'Pause globe rotation' });

// Every label that is up is one a reader can read; a fading one nearer the edge of its range is not.
export function expectNoFaintLabels(reading: AtlasLayerReading) {
	for (const entry of reading.markers.filter((candidate) => candidate.labelShown)) {
		expect(
			markerPresentation(entry.distanceMeters).labelAlpha,
			`${entry.slug} label alpha`
		).toBeGreaterThanOrEqual(ATLAS_MARKER_STYLE.labelMinAlpha);
	}
}

// The index the atlas is rendered with comes from the stub, so the expected markers are read
// from the same answer rather than from a count written into the test.
export async function servedIndex(request: APIRequestContext): Promise<IndexEntry[]> {
	const response = await request.get(`${STUB_API_URL}/api/v1/mountains`);
	return ((await response.json()) as { mountains: IndexEntry[] }).mountains;
}

export async function layer(page: Page): Promise<AtlasLayerReading> {
	const current = await atlasLayer(page);
	expect(current).toBeDefined();
	return current!;
}

export async function camera(page: Page): Promise<GlobePosition> {
	const current = await globePosition(page);
	expect(current).toBeDefined();
	return current!;
}

export async function canvasOf(page: Page): Promise<Canvas> {
	return page
		.locator('main canvas')
		.evaluate((canvas) => ({ width: canvas.clientWidth, height: canvas.clientHeight }));
}

export function marker(reading: AtlasLayerReading, slug: string): AtlasMarkerReading {
	const found = reading.markers.find((entry) => entry.slug === slug);
	expect(found, `marker ${slug}`).toBeDefined();
	return found!;
}

export function visibleSlugs(reading: AtlasLayerReading): string[] {
	return reading.markers.filter((entry) => entry.visible).map((entry) => entry.slug);
}

export function radians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

export function angleBetweenDegrees(
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
export function limbDegrees(distanceFromCenterMeters: number, elevationMeters = 0): number {
	const camera = Math.acos(EARTH_RADIUS_METERS / distanceFromCenterMeters);
	const summit = Math.acos(EARTH_RADIUS_METERS / (EARTH_RADIUS_METERS + elevationMeters));
	return ((camera + summit) * 180) / Math.PI;
}

export interface Verdict {
	violations: string[];
	hiddenBeyondLimb: number;
	visibleWithinLimb: number;
}

/**
 * Checks the layer against plain spherical geometry, independently of Cesium: a summit well past
 * the limb must be hidden, every visible marker must sit inside the canvas, and, when the whole
 * globe is framed, a summit well inside the limb must be shown.
 */
export function judge(
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
export async function expectGeometry(page: Page, entries: IndexEntry[], wholeGlobeInView: boolean) {
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

export async function expectOverviewSettled(page: Page) {
	await expect.poll(async () => (await camera(page)).orbiting, { timeout: 30_000 }).toBe(true);
}

export function overlapping(reading: AtlasLayerReading): string[] {
	const named = reading.markers.filter((entry) => entry.labelShown && entry.label);
	const clashes: string[] = [];
	for (const [index, a] of named.entries()) {
		for (const b of named.slice(index + 1)) {
			const [p, q] = [a.label!, b.label!];
			if (p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom) {
				clashes.push(`${a.slug} × ${b.slug}`);
			}
		}
	}
	return clashes;
}
