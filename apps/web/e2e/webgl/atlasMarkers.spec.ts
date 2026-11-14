import { ATLAS_MARKER_STYLE, markerPresentation } from '../../src/stage/globe/atlasMarkers';
import { resetStub, useScenario } from '../ssr/support';
import {
	LIMB_MARGIN_DEGREES,
	angleBetweenDegrees,
	camera,
	expectGeometry,
	expectNoFaintLabels,
	expectOverviewSettled,
	layer,
	limbDegrees,
	list,
	marker,
	overlapping,
	pauseRotation,
	servedIndex,
	visibleSlugs
} from './support/atlas';
import {
	DESKTOP,
	cameraAtRest,
	dragGlobe,
	expect,
	expectReadyStage,
	framesPass,
	test
} from './support/stage';

test.beforeEach(async ({ page, request }) => {
	await page.setViewportSize(DESKTOP);
	await useScenario(request, 'catalog');
});

test.afterEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('@webgl atlas markers on the catalog', () => {
	test('draws every mountain once, on the facing hemisphere only, where the geography puts it', async ({
		page,
		request
	}) => {
		const entries = await servedIndex(request);
		await page.goto('/atlas');
		await expectReadyStage(page);

		await test.step('one marker per index entry, in one layer, with default depth', async () => {
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

		await test.step('the facing hemisphere shows and the far one is hidden, as plain geometry says', async () => {
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

		await test.step('markers stand where the geography puts them on screen', async () => {
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

		await test.step('turning the globe brings the far side into view and hides the near side', async () => {
			const before = visibleSlugs(await layer(page));
			expect(before).not.toContain('aconcagua');

			await dragGlobe(page, 0.4);
			await cameraAtRest(page);

			const after = visibleSlugs(await layer(page));
			expect(after).toContain('aconcagua');
			expect(before.filter((slug) => !after.includes(slug)).length).toBeGreaterThan(0);
		});
	});

	test('names markers as the camera closes in, keeps neighbours apart and never overlaps two names', async ({
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
		let blanc = far;
		let matterhorn = marker(await layer(page), 'matterhorn');
		for (let step = 0; step < 60 && !(blanc.labelShown && matterhorn.labelShown); step += 1) {
			expect(blanc.visible).toBe(true);
			await page.mouse.move(box.x + blanc.window!.x, box.y + blanc.window!.y);
			await page.mouse.wheel(0, -900);
			await framesPass(page, 4);
			const reading = await layer(page);
			expectNoFaintLabels(reading);
			expect(overlapping(reading)).toEqual([]);
			blanc = marker(reading, 'mont-blanc');
			matterhorn = marker(reading, 'matterhorn');
			if (blanc.labelShown && !matterhorn.labelShown) {
				expect(matterhorn.labelSuppressed).toBe(true);
			}
		}
		await cameraAtRest(page);
		const reading = await layer(page);
		[blanc, matterhorn] = [marker(reading, 'mont-blanc'), marker(reading, 'matterhorn')];

		await test.step('a name shows only once its label is legible, and the marker grows', async () => {
			expect(blanc.labelShown).toBe(true);
			expect(far.distanceMeters).toBeGreaterThan(ATLAS_MARKER_STYLE.labelMaxMeters);
			expect(markerPresentation(blanc.distanceMeters).labelAlpha).toBeGreaterThanOrEqual(
				ATLAS_MARKER_STYLE.labelMinAlpha
			);
			expectNoFaintLabels(reading);
			expect(blanc.pointPixels).toBeGreaterThan(far.pointPixels);
		});

		await test.step('summits above the horizon but far beyond the frame are not drawn', async () => {
			const from = await camera(page);
			const offscreen = entries.filter(
				(entry) =>
					angleBetweenDegrees(from, entry.coordinates) <
						limbDegrees(from.distanceFromCenterMeters) - LIMB_MARGIN_DEGREES &&
					!marker(reading, entry.slug).visible
			);
			expect(offscreen.length).toBeGreaterThan(0);
		});

		await test.step('Mont Blanc and the Matterhorn are separate markers, both named once clear of each other', async () => {
			expect(reading.markers.filter((entry) => entry.slug === 'matterhorn')).toHaveLength(1);
			expect([blanc.visible, matterhorn.visible]).toEqual([true, true]);
			expect([blanc.labelShown, matterhorn.labelShown]).toEqual([true, true]);
			expect(
				Math.hypot(blanc.window!.x - matterhorn.window!.x, blanc.window!.y - matterhorn.window!.y)
			).toBeGreaterThan(1);
		});
	});
});
