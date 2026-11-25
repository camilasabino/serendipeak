import type { Page } from '@playwright/test';
import { resetStub, useScenario as selectScenario } from '../ssr/support';
import { ACONCAGUA, DESKTOP, expect, expectReadyStage, test } from './support/stage';

const stage = (page: Page) => page.locator('[data-stage]');
const control = (page: Page, name: string) =>
	stage(page).getByRole('button', { name, exact: true });
const shownTooltips = (page: Page) =>
	stage(page).locator('[aria-hidden="true"][data-side][data-visible="true"]');
const helpDialog = (page: Page) => page.getByRole('dialog', { name: 'How to navigate' });

async function openAtlas(page: Page, request: Parameters<typeof selectScenario>[0]) {
	await selectScenario(request, 'catalog');
	await page.goto('/atlas');
	await expectReadyStage(page);
}

async function openMountain(page: Page) {
	await page.goto(`/mountains/${ACONCAGUA.slug}`);
	await expectReadyStage(page);
}

test.afterEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('@webgl control tooltips on the atlas', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize(DESKTOP);
	});

	test('shows each control’s action the moment the pointer enters, and hides it on leaving', async ({
		page,
		request
	}) => {
		await openAtlas(page, request);
		const expected: Record<string, string> = {
			'Zoom in': 'Zoom in — Move closer',
			'Zoom out': 'Zoom out — Move farther away',
			'Reset view': 'Reset to the original view',
			'How to navigate': 'View navigation instructions',
			'Hide mountain markers': 'Hide mountain markers',
			'Enter fullscreen': 'Enter fullscreen'
		};

		for (const [name, text] of Object.entries(expected)) {
			const button = control(page, name);
			await expect(button, `${name} has no native title`).not.toHaveAttribute('title', /.*/);
			await button.hover();

			// One frame, not a delay: the tooltip is there as soon as the hover is dispatched.
			await expect(shownTooltips(page)).toHaveText(text, { timeout: 250 });
			await expect(button).toHaveAccessibleName(name);

			await page.mouse.move(DESKTOP.width / 2, DESKTOP.height / 2);
			await expect(shownTooltips(page)).toHaveCount(0, { timeout: 250 });
		}
	});

	test('explains the rotation toggle by its current action', async ({ page, request }) => {
		await openAtlas(page, request);
		const rotation = stage(page).getByRole('button', {
			name: /globe rotation$|^Rotate the globe$/
		});
		await expect(rotation).toBeVisible();

		await rotation.hover();
		const before = await shownTooltips(page).textContent();
		await rotation.click();

		await expect(shownTooltips(page)).not.toHaveText(before!, { timeout: 250 });
		expect(['Pause globe rotation', 'Resume globe rotation']).toContain(
			await shownTooltips(page).textContent()
		);
	});

	test('follows the marker state after a press, with the pointer still on the button', async ({
		page,
		request
	}) => {
		await openAtlas(page, request);

		await control(page, 'Hide mountain markers').click();

		await expect(shownTooltips(page)).toHaveText('Show mountain markers', { timeout: 250 });
		await control(page, 'Show mountain markers').click();
		await expect(shownTooltips(page)).toHaveText('Hide mountain markers', { timeout: 250 });
	});

	test('shows on keyboard focus, hides on blur and on Escape, and never takes pointer events', async ({
		page,
		request
	}) => {
		await openAtlas(page, request);

		await control(page, 'Zoom in').focus();
		await page.keyboard.press('Shift+Tab');
		await page.keyboard.press('Tab');
		await expect(control(page, 'Zoom in')).toBeFocused();
		await expect(shownTooltips(page)).toHaveText('Zoom in — Move closer', { timeout: 250 });
		const style = await shownTooltips(page).evaluate((element) => {
			const computed = getComputedStyle(element);
			return {
				events: computed.pointerEvents,
				transition: computed.transitionDuration,
				animation: computed.animationName
			};
		});
		expect(style).toEqual({ events: 'none', transition: '0s', animation: 'none' });

		await page.keyboard.press('Escape');
		await expect(shownTooltips(page)).toHaveCount(0, { timeout: 250 });

		await page.keyboard.press('Tab');
		await expect(shownTooltips(page)).toHaveText('Zoom out — Move farther away', {
			timeout: 250
		});
		await page.keyboard.press('Tab');
		await expect(shownTooltips(page)).toHaveText('View navigation instructions', {
			timeout: 250
		});
		await control(page, 'How to navigate').blur();
		await expect(shownTooltips(page)).toHaveCount(0, { timeout: 250 });
	});

	test('does not show over the open help, and the atlas help lists only atlas controls', async ({
		page,
		request
	}) => {
		await openAtlas(page, request);

		await control(page, 'How to navigate').click();
		await expect(helpDialog(page)).toBeVisible();
		await expect(shownTooltips(page)).toHaveCount(0);
		await control(page, 'Zoom in').hover();
		await control(page, 'Reset view').hover();
		await expect(shownTooltips(page)).toHaveCount(0);

		const help = helpDialog(page);
		await expect(help).toContainText('Back to the Atlas overview');
		await expect(help).toContainText('Hide the mountain markers');
		await expect(help).toContainText('Click a point or name');
		await expect(help).not.toContainText(/orbit|summit|starting view/);

		await control(page, 'Hide mountain markers').click();
		await expect(help).toBeHidden();
		await control(page, 'How to navigate').click();
		await expect(help).toContainText('Show the mountain markers');
		await expect(help).toContainText('Markers are hidden');

		await page.keyboard.press('Escape');
		await expect(helpDialog(page)).toBeHidden();
		await control(page, 'Zoom in').hover();
		await expect(shownTooltips(page).filter({ hasText: 'Zoom in' })).toHaveCount(1, {
			timeout: 250
		});
	});
});

test.describe('@webgl control tooltips on a mountain', () => {
	test('names the orbit and the markers by their actions and keeps atlas controls out of the help', async ({
		page
	}) => {
		await page.setViewportSize(DESKTOP);
		await openMountain(page);
		const orbit = stage(page).getByRole('button', { name: /mountain orbit$/ });
		await expect(orbit).toBeEnabled({ timeout: 30_000 });

		await orbit.hover();
		await expect(shownTooltips(page)).toHaveText('Start 360° orbit', { timeout: 250 });
		await orbit.click();
		await expect(shownTooltips(page)).toHaveText('Pause 360° orbit', { timeout: 250 });
		await orbit.click();
		await expect(shownTooltips(page)).toHaveText('Resume 360° orbit', { timeout: 250 });

		await control(page, 'How to navigate').click();
		const help = helpDialog(page);
		await expect(help).toContainText('360° orbit');
		await expect(help).toContainText('Moving the map yourself stops the orbit');
		await expect(help).toContainText('Back to the starting view');
		await expect(help).toContainText('Hide the summit marker');
		await expect(help).not.toContainText(/mountain markers|Atlas overview|rotation/i);
	});

	test('explains the markers switch by what it does now, and the tooltip follows it', async ({
		page
	}) => {
		await page.setViewportSize(DESKTOP);
		await openMountain(page);
		const markers = control(page, 'Hide mountain markers');

		await markers.hover();
		await expect(shownTooltips(page)).toHaveText('Hide mountain markers', { timeout: 250 });
		await markers.click();
		await expect(shownTooltips(page)).toHaveText('Show mountain markers', { timeout: 250 });

		await control(page, 'How to navigate').click();
		await expect(helpDialog(page)).toContainText('Show the summit marker');
		await page.keyboard.press('Escape');

		await control(page, 'Show mountain markers').focus();
		await expect(shownTooltips(page).filter({ hasText: 'Show mountain markers' })).toHaveCount(1, {
			timeout: 250
		});
		await page.keyboard.press('Space');
		await expect(control(page, 'Hide mountain markers')).toBeFocused();
		await expect(shownTooltips(page).filter({ hasText: 'Hide mountain markers' })).toHaveCount(1, {
			timeout: 250
		});
	});
});

test.describe('@webgl control tooltips near the edges', () => {
	for (const size of [
		{ width: 320, height: 568 },
		{ width: 390, height: 844 },
		{ width: 740, height: 360 }
	]) {
		test(`stay inside the stage at ${size.width}×${size.height}`, async ({ page, request }) => {
			await page.setViewportSize(size);
			await openAtlas(page, request);
			const bounds = (await stage(page).boundingBox())!;
			const names = await stage(page)
				.getByRole('button')
				.evaluateAll((buttons) =>
					buttons
						.filter((button) => !button.hasAttribute('disabled'))
						.map((button) => button.textContent!.trim())
				);

			for (const name of names.filter((text) => !/^Close/.test(text))) {
				await control(page, name).hover();
				const tooltip = shownTooltips(page);
				await expect(tooltip, name).toHaveCount(1, { timeout: 250 });
				const box = (await tooltip.boundingBox())!;
				expect(box.x, name).toBeGreaterThanOrEqual(bounds.x);
				expect(box.y, name).toBeGreaterThanOrEqual(bounds.y);
				expect(box.x + box.width, name).toBeLessThanOrEqual(bounds.x + bounds.width);
				expect(box.y + box.height, name).toBeLessThanOrEqual(bounds.y + bounds.height);
				await page.mouse.move(size.width / 2, size.height / 2);
			}
		});
	}
});

test.describe('@webgl control tooltips on touch', () => {
	test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

	test('never open on a tap, which still activates the control', async ({ page, request }) => {
		await openAtlas(page, request);

		await control(page, 'Hide mountain markers').tap();

		await expect(control(page, 'Show mountain markers')).toBeVisible();
		await expect(shownTooltips(page)).toHaveCount(0);
		await control(page, 'How to navigate').tap();
		await expect(helpDialog(page)).toBeVisible();
		await expect(shownTooltips(page)).toHaveCount(0);
	});
});

test.describe('@webgl control tooltips under reduced motion', () => {
	test.use({ reducedMotion: 'reduce' });

	test('appear at once and animate nothing', async ({ page, request }) => {
		await page.setViewportSize(DESKTOP);
		await openAtlas(page, request);

		await control(page, 'Reset view').hover();

		await expect(shownTooltips(page)).toHaveText('Reset to the original view', { timeout: 250 });
		const motion = await shownTooltips(page).evaluate((element) => {
			const computed = getComputedStyle(element);
			return [computed.transitionDuration, computed.animationName];
		});
		expect(motion).toEqual(['0s', 'none']);
	});
});

const tab = (page: Page, name: string) => helpDialog(page).getByRole('tab', { name });
const panels = (page: Page) => helpDialog(page).getByRole('tabpanel');

async function panelFit(page: Page) {
	return helpDialog(page).evaluate((panel) => {
		const stageBox = panel.closest('[data-stage]')!.getBoundingClientRect();
		const box = panel.getBoundingClientRect();
		const credit = document.querySelector('.cesium-widget-credits')?.getBoundingClientRect();
		return {
			insideStage: box.top >= stageBox.top - 1 && box.bottom <= stageBox.bottom + 1,
			clearOfCredits: credit ? box.bottom <= credit.top + 1 : true,
			noSidewaysScroll: panel.scrollWidth <= panel.clientWidth,
			scrolls: panel.scrollHeight > panel.clientHeight,
			overflowY: getComputedStyle(panel).overflowY
		};
	});
}

test.describe('@webgl navigation guide tabs', () => {
	test('shows one tab at a time, opens on Mouse, and follows the keyboard', async ({
		page,
		request
	}) => {
		await page.setViewportSize(DESKTOP);
		await openAtlas(page, request);
		await control(page, 'How to navigate').click();

		await expect(tab(page, 'Mouse')).toHaveAttribute('aria-selected', 'true');
		await expect(panels(page).filter({ visible: true })).toHaveCount(1);
		await expect(panels(page).filter({ visible: true })).toContainText('Drag the globe');

		await tab(page, 'Mouse').focus();
		await page.keyboard.press('ArrowRight');
		await expect(tab(page, 'Touch')).toBeFocused();
		await expect(tab(page, 'Touch')).toHaveAttribute('aria-selected', 'true');
		await expect(panels(page).filter({ visible: true })).toContainText('Pinch');
		await page.keyboard.press('End');
		await expect(tab(page, 'Controls')).toBeFocused();
		await expect(panels(page).filter({ visible: true })).toContainText(
			'Back to the Atlas overview'
		);
		await page.keyboard.press('ArrowRight');
		await expect(tab(page, 'Mouse')).toBeFocused();
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowLeft');
		await expect(tab(page, 'Controls')).toBeFocused();
		await expect(tab(page, 'Mouse')).toHaveAttribute('tabindex', '-1');
		await expect(panels(page).filter({ visible: true })).toHaveCount(1);

		await tab(page, 'Touch').click();
		await expect(panels(page).filter({ visible: true })).toContainText('Twist two fingers');
	});

	test('keeps Escape and focus management: closing returns focus to the help button', async ({
		page,
		request
	}) => {
		await page.setViewportSize(DESKTOP);
		await openAtlas(page, request);
		await control(page, 'How to navigate').click();
		await tab(page, 'Controls').click();

		await page.keyboard.press('Escape');

		await expect(helpDialog(page)).toBeHidden();
		await expect(control(page, 'How to navigate')).toBeFocused();
		await control(page, 'How to navigate').click();
		await helpDialog(page).getByRole('button', { name: 'Close navigation help' }).click();
		await expect(helpDialog(page)).toBeHidden();
	});

	test('shows the mountain controls tab with the orbit note, and no atlas rows', async ({
		page
	}) => {
		await page.setViewportSize(DESKTOP);
		await openMountain(page);
		await control(page, 'How to navigate').click();

		await tab(page, 'Controls').click();

		const visible = panels(page).filter({ visible: true });
		await expect(visible).toContainText('Circle the summit');
		await expect(visible).toContainText('Moving the map yourself stops the orbit.');
		await expect(visible).toContainText('Hide the summit marker');
		await expect(visible).not.toContainText(/mountain markers|Rotation|Atlas/);
		await tab(page, 'Mouse').click();
		await expect(panels(page).filter({ visible: true })).not.toContainText('Open');
	});

	for (const size of [
		{ width: 320, height: 568 },
		{ width: 390, height: 844 },
		{ width: 740, height: 360 }
	]) {
		test(`fits the stage, clears the credits and never scrolls sideways at ${size.width}×${size.height}`, async ({
			page,
			request
		}) => {
			await page.setViewportSize(size);
			await openAtlas(page, request);
			await control(page, 'How to navigate').click();

			for (const name of ['Mouse', 'Touch', 'Controls']) {
				await tab(page, name).click();
				const fit = await panelFit(page);
				expect(fit, name).toMatchObject({
					insideStage: true,
					clearOfCredits: true,
					noSidewaysScroll: true,
					overflowY: 'auto'
				});
			}
		});
	}

	test('stays scrollable on a short landscape stage', async ({ page, request }) => {
		await page.setViewportSize({ width: 740, height: 360 });
		await openAtlas(page, request);
		await control(page, 'How to navigate').click();
		await tab(page, 'Touch').click();

		expect((await panelFit(page)).scrolls).toBe(true);
		await helpDialog(page).evaluate((panel) => (panel.scrollTop = panel.scrollHeight));
		await expect(helpDialog(page).getByText('Tap a point or name')).toBeInViewport();
	});

	test('keeps the guide inside the stage with text enlarged', async ({ page, request }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await openAtlas(page, request);
		await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
		await control(page, 'How to navigate').click();
		await tab(page, 'Controls').click();

		expect(await panelFit(page)).toMatchObject({ noSidewaysScroll: true, clearOfCredits: true });
		await expect(
			helpDialog(page).getByRole('button', { name: 'Close navigation help' })
		).toBeInViewport();
		const wordLines = await helpDialog(page)
			.getByRole('heading', { name: 'How to navigate' })
			.evaluate((heading) => {
				const text = heading.firstChild as Text;
				const range = document.createRange();
				const start = text.data.indexOf('navigate');
				range.setStart(text, start);
				range.setEnd(text, start + 'navigate'.length);
				return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
			});
		expect(wordLines, 'the heading never breaks inside a word').toBe(1);
	});
});

test.describe('@webgl navigation guide on touch', () => {
	test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

	test('opens on the Touch tab', async ({ page, request }) => {
		await openAtlas(page, request);

		await control(page, 'How to navigate').tap();

		await expect(tab(page, 'Touch')).toHaveAttribute('aria-selected', 'true');
		await expect(panels(page).filter({ visible: true })).toContainText('Drag with one finger');
	});
});
