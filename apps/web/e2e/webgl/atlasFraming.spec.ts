import type { Page } from '@playwright/test';
import { resetStub, useScenario } from '../ssr/support';
import { chooseCountry, list, openFilters, popup } from './support/atlasList';
import {
	DESKTOP,
	cameraAtRest,
	dragGlobe,
	expect,
	expectReadyStage,
	framesPass,
	globePosition,
	liveViewers,
	test
} from './support/stage';

async function chooseBand(page: Page, floor: number) {
	await openFilters(page);
	const elevation = list(page).getByRole('button', { name: /^Elevation/ });
	if ((await elevation.getAttribute('aria-expanded')) !== 'true') {
		await elevation.click();
	}
	await list(page)
		.getByRole('checkbox', { name: new RegExp(`^${floor.toLocaleString('en')}–`) })
		.check();
	await page.keyboard.press('Escape');
}

async function chooseSort(page: Page, name: string) {
	await list(page).getByRole('button', { name: /^Sort/ }).click();
	await popup(page).getByRole('option', { name }).click();
}

const resetFilters = (page: Page) =>
	list(page).getByRole('button', { name: 'Reset filters and sort' });

async function camera(page: Page) {
	const position = await globePosition(page);
	expect(position).toBeDefined();
	return position!;
}

// The camera looks straight down a degree off the vertical, so it stands south of its look-at point
// by about a degree's tangent of its range: under half a degree at a regional distance, and more
// for a wide set. The tolerance is far inside what a frame needs.
async function expectCameraOver(page: Page, latitude: number, longitude: number, degrees = 0.5) {
	await expect
		.poll(async () => {
			const { latitude: lat, longitude: lon } = await camera(page);
			return Math.hypot(lat - latitude, lon - longitude);
		})
		.toBeLessThan(degrees);
}

test.beforeEach(async ({ page, request }) => {
	await page.setViewportSize(DESKTOP);
	await useScenario(request, 'regions');
});

test.afterEach(async ({ request }) => {
	await resetStub(request);
});

// Under reduced motion the camera is placed at once, so its position after a change is the answer.
test.describe('@webgl atlas geographic framing', () => {
	test.use({ reducedMotion: 'reduce' });

	test('frames the places a country or range leaves, and only those filters move the camera', async ({
		page
	}) => {
		await page.goto('/atlas');
		await expectReadyStage(page);
		await cameraAtRest(page);
		await page.waitForFunction(() => 'next' in window);
		const overview = await camera(page);

		await test.step('elevation alone and sort leave the overview where it is', async () => {
			await chooseBand(page, 6000);
			await framesPass(page, 6);
			await chooseSort(page, 'Highest first');
			await framesPass(page, 6);

			expect(await camera(page)).toMatchObject({
				latitude: overview.latitude,
				longitude: overview.longitude,
				distanceFromCenterMeters: overview.distanceFromCenterMeters
			});
			await resetFilters(page).click();
			await framesPass(page, 6);
			expect(await camera(page)).toMatchObject({ longitude: overview.longitude });
		});

		await test.step('a country with a single mountain frames it at a regional distance', async () => {
			await chooseCountry(page, 'Nepal');

			await expectCameraOver(page, 27.99, 86.93);
			const { heightMeters } = await camera(page);
			expect(heightMeters).toBeGreaterThan(950_000);
			expect(heightMeters).toBeLessThan(1_100_000);
		});

		await test.step('a country with scattered mountains frames the whole set', async () => {
			await chooseCountry(page, 'Chile');

			// Between Fitz Roy (-49.3) and the two northern summits (-23.3, -23.9).
			await expectCameraOver(page, -36.3, -70.1, 1.5);
			expect((await camera(page)).heightMeters).toBeGreaterThan(1_500_000);
		});

		await test.step('an elevation band narrows the framing to the matching subset', async () => {
			await chooseBand(page, 6000);

			await expectCameraOver(page, -23.3, -67.8);
		});

		await test.step('sorting does not move it', async () => {
			const before = await camera(page);
			await chooseSort(page, 'Lowest first');
			await framesPass(page, 6);

			expect(await camera(page)).toEqual(before);
		});

		await test.step('a reset returns to the overview it started from', async () => {
			await resetFilters(page).click();

			await expectCameraOver(page, overview.latitude, overview.longitude);
			await framesPass(page, 6);
			expect((await camera(page)).distanceFromCenterMeters).toBeCloseTo(
				overview.distanceFromCenterMeters,
				0
			);
		});

		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
	});
});

test.describe('@webgl atlas continent framing', () => {
	test.use({ reducedMotion: 'reduce' });

	const trail = (page: Page) => page.getByRole('navigation', { name: 'Atlas trail' });
	const southAmerica = (page: Page) =>
		list(page)
			.locator('ul > li > button')
			.filter({ hasText: /^South America/ });

	test('frames a continent once, keeps it for its ranges, and leaves the camera to the reader', async ({
		page
	}) => {
		await page.goto('/atlas');
		await expectReadyStage(page);
		await cameraAtRest(page);
		await page.waitForFunction(() => 'next' in window);
		const overview = await camera(page);

		await southAmerica(page).click();
		await expectCameraOver(page, -37, -70, 25);
		await cameraAtRest(page);
		const continent = await camera(page);
		expect(continent.distanceFromCenterMeters).toBeLessThan(overview.distanceFromCenterMeters);

		await list(page)
			.getByRole('button', { name: 'Browse mountain ranges in South America' })
			.click();
		await framesPass(page, 8);
		expect(await camera(page)).toEqual(continent);

		await list(page)
			.getByRole('button', { name: /^Andes(\d|\s|$)/ })
			.click();
		await list(page)
			.getByRole('button', { name: /^Patagonian Andes/ })
			.click();
		await expectCameraOver(page, -49.3, -73, 1);

		await trail(page).getByRole('button', { name: 'South America' }).click();
		await expectCameraOver(page, continent.latitude, continent.longitude);
		await framesPass(page, 6);
		expect((await camera(page)).distanceFromCenterMeters).toBeCloseTo(
			continent.distanceFromCenterMeters,
			0
		);

		await dragGlobe(page, 0.15);
		await cameraAtRest(page);
		const dragged = await camera(page);
		expect(dragged.longitude).not.toBeCloseTo(continent.longitude, 1);
		await framesPass(page, 8);
		expect(await camera(page)).toEqual(dragged);

		await list(page).getByRole('button', { name: 'Back to South America mountains' }).click();
		await framesPass(page, 6);
		expect((await camera(page)).distanceFromCenterMeters).toBeCloseTo(
			dragged.distanceFromCenterMeters,
			0
		);

		await list(page).getByRole('button', { name: 'All continents' }).click();
		await expectCameraOver(page, overview.latitude, overview.longitude);
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
	});
});
