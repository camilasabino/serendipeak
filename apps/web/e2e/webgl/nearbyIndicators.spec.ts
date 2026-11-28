import type { Locator, Page } from '@playwright/test';
import { resetStub, serveMountain, useScenario } from '../ssr/support';
import {
	ACONCAGUA,
	DESKTOP,
	cameraAtRest,
	cameraReading,
	expect,
	expectReadyStage,
	framesPass,
	globePosition,
	liveViewers,
	test
} from './support/stage';

interface Summit {
	latitude: number;
	longitude: number;
}

// The `catalog` index lists both near Aconcagua; El Plata's page is served here by slug.
const EL_PLATA = {
	...ACONCAGUA,
	slug: 'cerro-el-plata',
	name: 'Cerro El Plata',
	coordinates: { latitude: -33.015925, longitude: -69.454922 }
};
// The catalog's own pose and neighbours: Ama Dablam, Kangchenjunga and Machapuchare.
const EVEREST = {
	...ACONCAGUA,
	slug: 'mount-everest',
	name: 'Mount Everest',
	coordinates: { latitude: 27.9880614, longitude: 86.92521 },
	elevationMeters: 8849,
	camera: {
		headingDegrees: 103.3,
		pitchDegrees: 1.39,
		rangeMeters: 14828,
		framing: { x: 0.047, y: 0.4068 }
	}
};
// The catalog's pose and neighbours: Mont Blanc, the Matterhorn and the Eiger, all in the frame
// of the canonical view and all beyond its horizon, which flat test terrain leaves unchanged.
const ANETO = {
	...ACONCAGUA,
	slug: 'aneto',
	name: 'Aneto',
	coordinates: { latitude: 42.6311462, longitude: 0.6566507 },
	elevationMeters: 3404,
	camera: {
		headingDegrees: 38.32,
		pitchDegrees: -5.95,
		rangeMeters: 4750,
		framing: { x: 0.002, y: 0.2152 }
	}
};
const SUMMITS: Record<string, Summit> = {
	'Cerro El Plata': EL_PLATA.coordinates,
	'Ojos del Salado': { latitude: -27.1092, longitude: -68.5414 }
};
// Half the horizontal field of view on the desktop stage is 30°; past this a summit is surely off it.
const SURELY_OFF_SIDE_DEGREES = 42;

const marks = (page: Page) => page.locator('main [data-nearby-slug]');
const mark = (page: Page, name: string) => marks(page).filter({ hasText: name }).first();
const group = (page: Page) => page.getByRole('group', { name: 'Nearby mountains on the stage' });
const primary = (page: Page) => page.getByRole('navigation', { name: 'Primary' });

function bearingDegrees(from: Summit, to: Summit): number {
	const φ1 = (from.latitude * Math.PI) / 180;
	const φ2 = (to.latitude * Math.PI) / 180;
	const Δλ = ((to.longitude - from.longitude) * Math.PI) / 180;
	const y = Math.sin(Δλ) * Math.cos(φ2);
	const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

	return (Math.atan2(y, x) * 180) / Math.PI;
}

function signedTurn(degrees: number): number {
	return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

/** How far the camera must turn to face a summit, positive to the right. */
async function turnTo(page: Page, summit: Summit): Promise<number> {
	const camera = await globePosition(page);
	const reading = await cameraReading(page);
	expect(camera && reading).toBeTruthy();

	return signedTurn(bearingDegrees(camera!, summit) - reading!.headingDegrees);
}

/** The state a mark is in: its form while shown, or the reason it is not. */
async function stateOf(link: Locator): Promise<string> {
	return link.evaluate((element) => {
		const { mode, hidden } = (element as HTMLElement).dataset;

		return mode ?? `hidden:${hidden ?? 'unexplained'}`;
	});
}

/** Zooms with the wheel over the stage, which leaves keyboard focus where it is, until a mark is in a mode. */
async function zoomUntil(
	page: Page,
	link: Locator,
	mode: 'edge' | 'summit' | 'bearing',
	delta: number,
	attempts = 14
) {
	const box = (await page.locator('main canvas').boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		if ((await link.getAttribute('data-mode')) === mode) {
			return;
		}
		await page.mouse.wheel(0, delta);
		await cameraAtRest(page);
	}
	await expect(link).toHaveAttribute('data-mode', mode);
}

/** Each summit well off to one side must be pointed to from that side of the stage. */
async function expectSidesMatchCamera(page: Page) {
	let checked = 0;
	for (const [name, summit] of Object.entries(SUMMITS)) {
		const turn = await turnTo(page, summit);
		if (Math.abs(turn) < SURELY_OFF_SIDE_DEGREES) {
			continue;
		}
		checked += 1;
		await expect(mark(page, name)).toHaveAttribute('data-edge', turn > 0 ? 'right' : 'left');
	}

	return checked;
}

async function expectInsideStage(link: Locator, page: Page, part: 'chip' | 'label') {
	const stage = (await page.locator('main canvas').boundingBox())!;
	const box = (await link.locator(`[data-part="${part}"]`).boundingBox())!;

	expect(box.x).toBeGreaterThanOrEqual(stage.x + 8 - 1);
	expect(box.y).toBeGreaterThanOrEqual(stage.y + 8 - 1);
	expect(box.x + box.width).toBeLessThanOrEqual(stage.x + stage.width - 8 + 1);
	expect(box.y + box.height).toBeLessThanOrEqual(stage.y + stage.height - 8 + 1);
}

/** A bearing chip's box and the column it is centred on, in page pixels. */
async function bearingOf(link: Locator) {
	return link.evaluate((element) => {
		const box = element.querySelector<HTMLElement>('[data-part="chip"]')!.getBoundingClientRect();

		return {
			box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
			x: (box.left + box.right) / 2
		};
	});
}

async function probeViewer(page: Page) {
	await page.waitForFunction(() => 'next' in window);
	await page
		.locator('main canvas')
		.evaluate((element) => element.setAttribute('data-probe', 'first-viewer'));
}

/** The element the details sheet scrolls in: the nearest scrollable ancestor of the mountain's name. */
const sheetOf = (page: Page) =>
	page.getByRole('heading', { level: 1 }).evaluateHandle((heading) => {
		for (let element = heading.parentElement; element; element = element.parentElement) {
			if (/auto|scroll/.test(getComputedStyle(element).overflowY)) {
				return element;
			}
		}
		return document.scrollingElement!;
	});

test.beforeEach(async ({ request, page }) => {
	await resetStub(request);
	await useScenario(request, 'catalog');
	await serveMountain(request, EL_PLATA);
	await serveMountain(request, EVEREST);
	await serveMountain(request, ANETO);
	await page.setViewportSize(DESKTOP);
});

test.afterEach(async ({ request }) => {
	await resetStub(request);
});

async function openStage(page: Page, path: string) {
	await page.goto(path);
	await expectReadyStage(page);
	await cameraAtRest(page);
}

test.describe('@webgl nearby mountains on the stage', () => {
	test('point from the side each summit lies on, mark it where it stands once in view, and never move the camera', async ({
		page
	}) => {
		await openStage(page, `/mountains/${ACONCAGUA.slug}`);

		await test.step('both summits off the view are pointed to, from inside the stage', async () => {
			await expect(mark(page, 'Cerro El Plata')).toHaveAttribute('data-mode', 'edge');
			expect(await expectSidesMatchCamera(page)).toBeGreaterThan(0);
			for (const name of Object.keys(SUMMITS)) {
				if ((await stateOf(mark(page, name))) === 'edge') {
					await expectInsideStage(mark(page, name), page, 'chip');
					expect(
						(await mark(page, name).locator('[data-part="chip"]').boundingBox())!.height
					).toBeGreaterThanOrEqual(44);
				}
			}
			await expect(group(page)).toBeVisible();
		});

		await test.step('showing them moves nothing', async () => {
			const before = await cameraReading(page);
			await framesPass(page, 10);
			const after = await cameraReading(page);

			expect(after?.headingDegrees).toBeCloseTo(before!.headingDegrees, 6);
			expect(after?.rangeMeters).toBeCloseTo(before!.rangeMeters, 3);
		});
		await test.step('zooming out brings a summit into view: its chip becomes a marker on it, one link and focus kept', async () => {
			const link = mark(page, 'Cerro El Plata');
			await link.focus();
			await expect(link).toBeFocused();

			await zoomUntil(page, link, 'summit', 600);

			await expect(link).toBeFocused();
			await expect(marks(page).filter({ hasText: 'Cerro El Plata' })).toHaveCount(1);
			const stage = (await page.locator('main canvas').boundingBox())!;
			const disc = (await link.locator('[class*="disc"]').boundingBox())!;
			expect(disc.x + disc.width / 2).toBeGreaterThan(stage.x);
			expect(disc.x + disc.width / 2).toBeLessThan(stage.x + stage.width);
			expect(disc.y + disc.height / 2).toBeGreaterThan(stage.y);
			expect(disc.y + disc.height / 2).toBeLessThan(stage.y + stage.height);
			const press = (await link.boundingBox())!;
			expect(press.width).toBeGreaterThanOrEqual(43.9);
			expect(press.height).toBeGreaterThanOrEqual(43.9);
			if ((await link.getAttribute('data-label')) === 'shown') {
				await expectInsideStage(link, page, 'label');
			}
		});

		await test.step('zooming back in takes it out of view again: the chip returns, focus kept', async () => {
			const link = mark(page, 'Cerro El Plata');

			await zoomUntil(page, link, 'edge', -600);

			await expect(link).toBeFocused();
			await expect(link).toHaveAttribute('data-edge', /left|right|top|bottom/);
		});
	});

	test('account for every neighbour on Mount Everest: marked, pointed to, or hidden for a stated reason', async ({
		page
	}) => {
		await openStage(page, `/mountains/${EVEREST.slug}`);

		await test.step('Ama Dablam and Machapuchare are pointed to, Kangchenjunga is accounted for', async () => {
			await expect(marks(page)).toHaveCount(3);
			await expect(mark(page, 'Ama Dablam')).toHaveAttribute('data-mode', 'edge');
			await expect(mark(page, 'Ama Dablam')).toHaveAttribute('data-edge', 'right');
			await expect(mark(page, 'Machapuchare')).toHaveAttribute('data-mode', 'edge');

			// In frame, 9 px from Everest's own summit: marked there or, where terrain hides it, left
			// out with its reason. Never missing without one.
			const kangchenjunga = await stateOf(mark(page, 'Kangchenjunga'));
			expect(kangchenjunga).toMatch(/^(summit|bearing|hidden:covered)$/);
		});
	});

	test('name summits beyond the horizon on Aneto by their bearing, then on the summit once zooming out clears it', async ({
		page
	}) => {
		const names = ['Mont Blanc', 'Matterhorn', 'Eiger'];
		await openStage(page, `/mountains/${ANETO.slug}`);

		await test.step('all three stand on their bearings, right of centre in bearing order, none over another', async () => {
			await expect(marks(page)).toHaveCount(3);
			for (const name of names) {
				await expect(mark(page, name)).toHaveAttribute('data-mode', 'bearing');
				await expectInsideStage(mark(page, name), page, 'chip');
			}
			const stage = (await page.locator('main canvas').boundingBox())!;
			const [montBlanc, matterhorn, eiger] = await Promise.all(
				names.map((name) => bearingOf(mark(page, name)))
			);
			expect(eiger!.x).toBeGreaterThan(stage.x + stage.width / 2);
			expect(eiger!.x).toBeLessThan(montBlanc!.x);
			expect(montBlanc!.x).toBeLessThan(matterhorn!.x);
			const chips = [montBlanc!, matterhorn!, eiger!].map(({ box }) => box);
			for (const [index, box] of chips.entries()) {
				for (const other of chips.slice(index + 1)) {
					expect(
						box.left < other.right &&
							other.left < box.right &&
							box.top < other.bottom &&
							other.top < box.bottom
					).toBe(false);
				}
			}
			await expect(group(page)).toBeVisible();
		});

		await test.step('showing them moves nothing', async () => {
			const before = await cameraReading(page);
			await framesPass(page, 10);
			const after = await cameraReading(page);

			expect(after?.headingDegrees).toBeCloseTo(before!.headingDegrees, 6);
			expect(after?.rangeMeters).toBeCloseTo(before!.rangeMeters, 3);
		});

		await test.step('zooming out lifts Mont Blanc over the horizon: one link, now on its summit, focus kept', async () => {
			const link = mark(page, 'Mont Blanc');
			await link.focus();

			await zoomUntil(page, link, 'summit', 600, 30);

			await expect(link).toBeFocused();
			await expect(marks(page).filter({ hasText: 'Mont Blanc' })).toHaveCount(1);
		});

		await test.step('zooming back in hides it behind the horizon again: back on its bearing, focus kept', async () => {
			const link = mark(page, 'Mont Blanc');

			await zoomUntil(page, link, 'bearing', -600, 30);

			await expect(link).toBeFocused();
		});
	});

	test('open the mountain they name on the same globe, start its sheet from the top, and give way to hidden markers and the atlas', async ({
		page
	}) => {
		await openStage(page, `/mountains/${ACONCAGUA.slug}`);
		await probeViewer(page);

		await test.step('the sheet stays where the reader left it while nothing changes the mountain', async () => {
			const sheet = await sheetOf(page);
			const scrolled = await sheet.evaluate((element) => {
				element.scrollTop = 400;
				return element.scrollTop;
			});
			expect(scrolled).toBeGreaterThan(0);

			await page.getByRole('button', { name: 'Imperial, feet' }).click();
			await framesPass(page, 5);

			expect(await sheet.evaluate((element) => element.scrollTop)).toBe(scrolled);
			await page.getByRole('button', { name: 'Metric, meters' }).click();
		});

		await test.step('a press opens the mountain from the top of its sheet, and its neighbours are pointed to on arrival', async () => {
			await mark(page, 'Cerro El Plata').click();

			await expect(page).toHaveURL(new RegExp(`/mountains/${EL_PLATA.slug}$`));
			const heading = page.getByRole('heading', { level: 1 });
			await expect(heading).toHaveText(EL_PLATA.name);
			const sheet = await sheetOf(page);
			expect(await sheet.evaluate((element) => element.scrollTop)).toBe(0);
			await expect(heading).toBeInViewport();
			await expect(marks(page).filter({ hasText: 'Cerro El Plata' })).toHaveCount(0);
			await cameraAtRest(page);
			await expect(mark(page, 'Aconcagua')).toHaveCount(1);
			await expect(page.locator('main canvas[data-probe="first-viewer"]')).toHaveCount(1);
			expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		});

		await test.step('hiding markers takes them away, and showing markers brings them back', async () => {
			await page.getByRole('button', { name: 'Hide mountain markers' }).click();
			await expect(marks(page)).toHaveCount(0);
			await expect(group(page)).toHaveCount(0);

			await page.getByRole('button', { name: 'Show mountain markers' }).click();
			await expect(mark(page, 'Aconcagua')).toHaveCount(1);
		});

		await test.step('the atlas shows none', async () => {
			await primary(page).getByRole('link', { name: 'Atlas' }).click();

			await expect(page).toHaveURL(/\/atlas$/);
			await expect(marks(page)).toHaveCount(0);
		});
	});

	test('show the same marks on the page of the day, and none where it has no neighbours', async ({
		page,
		request
	}) => {
		await test.step('with neighbours, as on its permalink', async () => {
			await openStage(page, '/');

			await expect(marks(page).first()).toBeAttached();
			await expect(mark(page, 'Cerro El Plata')).toHaveAttribute('data-mode', /edge|summit/);
			await expect(group(page)).toBeVisible();
		});

		await test.step('without any, there is nothing to show', async () => {
			await useScenario(request, 'ok');
			await openStage(page, '/');

			await expect(marks(page)).toHaveCount(0);
			await expect(group(page)).toHaveCount(0);
		});
	});
});
