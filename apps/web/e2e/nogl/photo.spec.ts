import { expect, test, type Locator, type Page } from '@playwright/test';
import { fixture, resetStub } from '../ssr/support';

interface Photo {
	url: string;
	thumbnailUrl: string;
	width: number;
	height: number;
	author: string;
	license: string;
	licenseUrl: string;
	sourcePageUrl: string;
}

interface Named {
	slug: string;
	name: string;
	primaryImage?: Photo;
}

const ACONCAGUA = fixture<Named>('mountain-complete.json');
const OLYMPUS = fixture<Named>('mountain-sparse.json');
const BARE_PEAK = fixture<Named>('mountain-minimal.json');
const DAILY = fixture<{ mountain: Named }>('daily-mountain.json').mountain;

const ACONCAGUA_PHOTO = ACONCAGUA.primaryImage!;
const OLYMPUS_PHOTO = OLYMPUS.primaryImage!;

const A = 'Aconcagua2016';
const B = 'Mytikas_peak_02';
const COLORS: Record<string, string> = { [A]: '#b3261e', [B]: '#1e4fb3' };

type Mode = 'ok' | 'hold' | 'abort' | 'garbage';

function isLocal(url: URL): boolean {
	return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
}

function isWikimedia(url: URL): boolean {
	return url.hostname.endsWith('wikimedia.org');
}

function photoName(url: URL): string | undefined {
	return [A, B].find((name) => url.pathname.includes(name));
}

function svgFor(url: URL, photo: Photo): string {
	const width = Number(/\/(\d+)px-/.exec(url.pathname)?.[1] ?? 1280);
	const height = Math.round((width * photo.height) / photo.width);
	const color = COLORS[photoName(url) ?? A];

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`;
}

// Every non-local request is blocked except the Wikimedia photographs, which are served locally.
async function watch(page: Page) {
	const modes = new Map<string, Mode>();
	const gates = new Map<string, { promise: Promise<void>; open: () => void }>();
	const requested: { name: string; width: number | undefined; url: URL; pageUrl: string }[] = [];
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];

	function gateOf(name: string) {
		let gate = gates.get(name);
		if (!gate) {
			let open = () => {};
			const promise = new Promise<void>((resolve) => {
				open = resolve;
			});
			gate = { promise, open };
			gates.set(name, gate);
		}
		return gate;
	}

	page.on('pageerror', (error) => pageErrors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') consoleErrors.push(message.text());
	});
	await page.route(
		(url) => !isLocal(url),
		async (route) => {
			const url = new URL(route.request().url());
			const name = photoName(url);

			if (!isWikimedia(url) || !name) {
				await route.abort('blockedbyclient');
				return;
			}

			const width = /\/(\d+)px-/.exec(url.pathname)?.[1];
			requested.push({
				name,
				width: width === undefined ? undefined : Number(width),
				url,
				pageUrl: page.url()
			});

			const mode = modes.get(name) ?? 'ok';
			if (mode === 'hold') {
				await gateOf(name).promise;
			}
			if (mode === 'abort') {
				await route.abort('failed');
				return;
			}
			if (mode === 'garbage') {
				await route.fulfill({ status: 200, contentType: 'image/jpeg', body: 'not an image' });
				return;
			}

			const photo = name === A ? ACONCAGUA_PHOTO : OLYMPUS_PHOTO;
			await route.fulfill({
				status: 200,
				contentType: 'image/svg+xml',
				headers: { 'Access-Control-Allow-Origin': '*' },
				body: svgFor(url, photo)
			});
		}
	);

	return {
		pageErrors,
		consoleErrors,
		requested,
		mode(name: string, mode: Mode) {
			modes.set(name, mode);
			if (mode !== 'hold') {
				gateOf(name).open();
			}
		},
		hold(name: string) {
			gates.delete(name);
			modes.set(name, 'hold');
		},
		release(name: string) {
			modes.set(name, 'ok');
			gateOf(name).open();
		}
	};
}

const frame = (page: Page) => page.locator('figure [data-state]');
const photo = (page: Page) => frame(page).locator('img');
const openButton = (page: Page) => page.getByRole('button', { name: 'View photo fullscreen' });
const viewer = (page: Page) => page.getByRole('dialog');

async function open(page: Page, slug: string) {
	await page.goto(`/mountains/${slug}`, { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function navigate(page: Page, name: string, slug: string) {
	await page.evaluate(
		(href) =>
			(window as unknown as { next: { router: { push(h: string): void } } }).next.router.push(href),
		`/mountains/${slug}`
	);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

async function box(locator: Locator) {
	const found = await locator.boundingBox();
	expect(found).not.toBeNull();
	return found!;
}

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('@nogl Photograph reveal', () => {
	test('reserves the natural ratio and keeps the frame still while the image is revealed', async ({
		page
	}) => {
		const watched = await watch(page);
		watched.hold(A);

		await open(page, ACONCAGUA.slug);

		await expect(frame(page)).toHaveAttribute('data-state', 'pending');
		await expect(photo(page)).toHaveCSS('opacity', '0');
		await expect(openButton(page)).toBeDisabled();
		const pending = await box(frame(page));
		expect(pending.width / pending.height).toBeCloseTo(
			ACONCAGUA_PHOTO.width / ACONCAGUA_PHOTO.height,
			2
		);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(ACONCAGUA.name);

		watched.release(A);

		await expect(frame(page)).toHaveAttribute('data-state', 'ready');
		await expect(photo(page)).toHaveCSS('opacity', '1');
		await expect(openButton(page)).toBeEnabled();
		expect(await box(frame(page))).toEqual(pending);
		expect(watched.pageErrors).toEqual([]);
		expect(
			watched.consoleErrors.filter((text) => /hydrat|React error|did not match/i.test(text))
		).toEqual([]);
	});

	test('keeps the credit reachable and coherent with the photograph on screen', async ({
		page
	}) => {
		await watch(page);
		await open(page, ACONCAGUA.slug);

		await page.getByText('About this photo').click();

		await expect(page.getByText(ACONCAGUA_PHOTO.author)).toBeVisible();
		await expect(page.getByRole('link', { name: ACONCAGUA_PHOTO.license })).toHaveAttribute(
			'href',
			ACONCAGUA_PHOTO.licenseUrl
		);
		await expect(page.getByRole('link', { name: ACONCAGUA_PHOTO.author })).toHaveAttribute(
			'href',
			ACONCAGUA_PHOTO.sourcePageUrl
		);
	});

	test('renders nothing for a mountain without a photograph', async ({ page }) => {
		await watch(page);
		await open(page, BARE_PEAK.slug);

		await expect(page.locator('figure')).toHaveCount(0);
		await expect(openButton(page)).toHaveCount(0);
		await expect(page.getByText('About this photo')).toHaveCount(0);
	});
});

test.describe('@nogl Contract-only photograph URLs', () => {
	const cases = [
		{ label: 'desktop at 1x', viewport: { width: 1280, height: 800 }, scale: 1 },
		{ label: 'phone at 2x', viewport: { width: 390, height: 844 }, scale: 2 },
		{ label: 'desktop at 2x', viewport: { width: 1280, height: 800 }, scale: 2 }
	];

	for (const { label, viewport, scale } of cases) {
		test.describe(label, () => {
			test.use({ viewport, deviceScaleFactor: scale });

			test('requests only the contract thumbnail on the page', async ({ page }) => {
				const watched = await watch(page);

				await open(page, ACONCAGUA.slug);
				await expect(frame(page)).toHaveAttribute('data-state', 'ready');

				const thumbnail = new URL(ACONCAGUA_PHOTO.thumbnailUrl);
				const current = await photo(page).evaluate((img: HTMLImageElement) => img.currentSrc);
				expect(current).toBe(ACONCAGUA_PHOTO.thumbnailUrl);
				expect(await photo(page).getAttribute('srcset')).toBeNull();
				expect(
					watched.requested.every((request) => request.url.pathname === thumbnail.pathname)
				).toBe(true);
			});
		});
	}

	test.describe('viewer on a dense large screen', () => {
		test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

		test('upgrades to the contract original and never to a derived width', async ({ page }) => {
			const watched = await watch(page);
			const original = new URL(ACONCAGUA_PHOTO.url);
			const thumbnail = new URL(ACONCAGUA_PHOTO.thumbnailUrl);

			await open(page, ACONCAGUA.slug);
			await expect(openButton(page)).toBeEnabled();
			await openButton(page).click();

			await expect(viewer(page).getByRole('img')).toHaveAttribute('src', ACONCAGUA_PHOTO.url);
			const allowed = new Set([original.pathname, thumbnail.pathname]);
			expect(watched.requested.every((request) => allowed.has(request.url.pathname))).toBe(true);
		});
	});
});

test.describe('@nogl Photograph failure', () => {
	for (const mode of ['abort', 'garbage'] as const) {
		test(`removes the whole figure when the image cannot be used (${mode})`, async ({ page }) => {
			const watched = await watch(page);
			watched.mode(A, mode);

			await open(page, ACONCAGUA.slug);

			await expect(page.locator('figure')).toHaveCount(0);
			await expect(page.getByText('About this photo')).toHaveCount(0);
			await expect(page.getByRole('link', { name: ACONCAGUA_PHOTO.author })).toHaveCount(0);
			await expect(page.getByRole('heading', { level: 1 })).toHaveText(ACONCAGUA.name);
			await expect(page.getByRole('link', { name: /Wikipedia/ })).toBeVisible();
			expect(watched.pageErrors).toEqual([]);
		});
	}

	test('tries the photograph again when a later navigation returns to it', async ({ page }) => {
		const watched = await watch(page);
		watched.mode(A, 'abort');
		await open(page, ACONCAGUA.slug);
		await expect(page.locator('figure')).toHaveCount(0);

		await navigate(page, OLYMPUS.name, OLYMPUS.slug);
		await expect(frame(page)).toHaveAttribute('data-state', 'ready');
		watched.mode(A, 'ok');
		await navigate(page, ACONCAGUA.name, ACONCAGUA.slug);

		await expect(frame(page)).toHaveAttribute('data-state', 'ready');
		await expect(photo(page)).toHaveAttribute('alt', `Photograph of ${ACONCAGUA.name}`);
	});
});

test.describe('@nogl Stale photographs', () => {
	test('a late image of the mountain left behind never replaces the current one', async ({
		page
	}) => {
		const watched = await watch(page);
		watched.hold(A);
		await open(page, ACONCAGUA.slug);
		await expect(frame(page)).toHaveAttribute('data-state', 'pending');

		await navigate(page, OLYMPUS.name, OLYMPUS.slug);
		await expect(frame(page)).toHaveAttribute('data-state', 'ready');
		watched.release(A);
		await page.waitForTimeout(300);

		await expect(frame(page)).toHaveAttribute('data-state', 'ready');
		await expect(photo(page)).toHaveAttribute('alt', `Photograph of ${OLYMPUS.name}`);
		expect(await photo(page).evaluate((img: HTMLImageElement) => img.currentSrc)).toContain(B);
		await page.getByText('About this photo').click();
		await expect(page.getByText(OLYMPUS_PHOTO.author)).toBeVisible();
		await expect(page.getByText(ACONCAGUA_PHOTO.author)).toHaveCount(0);
	});

	test('stays hidden until the destination itself is ready, whatever the old one does', async ({
		page
	}) => {
		const watched = await watch(page);
		watched.hold(A);
		await open(page, ACONCAGUA.slug);

		watched.hold(B);
		await navigate(page, OLYMPUS.name, OLYMPUS.slug);
		watched.release(A);
		await page.waitForTimeout(300);

		await expect(frame(page)).toHaveAttribute('data-state', 'pending');
		await expect(photo(page)).toHaveCSS('opacity', '0');
		await expect(openButton(page)).toBeDisabled();

		watched.release(B);

		await expect(frame(page)).toHaveAttribute('data-state', 'ready');
		await expect(photo(page)).toHaveCSS('opacity', '1');
		expect(await photo(page).evaluate((img: HTMLImageElement) => img.currentSrc)).toContain(B);
	});

	test('reveals each photograph again when going back and forth between cached ones', async ({
		page
	}) => {
		await watch(page);
		await open(page, ACONCAGUA.slug);
		await expect(frame(page)).toHaveAttribute('data-state', 'ready');

		for (const [name, slug, alt] of [
			[OLYMPUS.name, OLYMPUS.slug, OLYMPUS.name],
			[ACONCAGUA.name, ACONCAGUA.slug, ACONCAGUA.name],
			[OLYMPUS.name, OLYMPUS.slug, OLYMPUS.name]
		] as const) {
			await navigate(page, name, slug);
			await expect(frame(page)).toHaveAttribute('data-state', 'ready');
			await expect(photo(page)).toHaveAttribute('alt', `Photograph of ${alt}`);
		}

		await page.goBack();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(ACONCAGUA.name);
		await expect(frame(page)).toHaveAttribute('data-state', 'ready');
		expect(await photo(page).evaluate((img: HTMLImageElement) => img.currentSrc)).toContain(A);
	});

	test('shows the same photograph on the daily page and on its permalink', async ({ page }) => {
		await watch(page);
		await page.goto('/');
		await expect(frame(page)).toHaveAttribute('data-state', 'ready');

		await navigate(page, DAILY.name, DAILY.slug);

		await expect(frame(page)).toHaveAttribute('data-state', 'ready');
		expect(await photo(page).evaluate((img: HTMLImageElement) => img.currentSrc)).toContain(A);
	});

	test('Explore warms the destination photograph before travelling and then reveals it', async ({
		page
	}) => {
		const watched = await watch(page);
		await page.route('**/api/v1/mountains/random**', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
				body: JSON.stringify(OLYMPUS)
			})
		);
		await open(page, ACONCAGUA.slug);
		await expect(frame(page)).toHaveAttribute('data-state', 'ready');

		await page.getByRole('button', { name: /^Explore another/ }).click();

		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await expect(frame(page)).toHaveAttribute('data-state', 'ready');
		const first = watched.requested.find((request) => request.name === B);
		expect(first?.pageUrl).toContain(`/mountains/${ACONCAGUA.slug}`);
		expect(watched.pageErrors).toEqual([]);
	});
});

test.describe('@nogl Photograph viewer', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test('opens on the production photograph with its credit and leaves the stage alone', async ({
		page
	}) => {
		const watched = await watch(page);
		await open(page, ACONCAGUA.slug);
		await expect(openButton(page)).toBeEnabled();
		const stage = page.locator('main > :last-child');
		await expect(stage.getByRole('alert')).toBeVisible();
		await stage.evaluate((node) => node.setAttribute('data-probe', 'untouched'));
		const stageBefore = await stage.innerHTML();

		await openButton(page).click();

		await expect(viewer(page)).toBeVisible();
		await expect(viewer(page).getByRole('button', { name: 'Close' })).toBeFocused();
		await expect(viewer(page).getByRole('img')).toHaveAttribute(
			'alt',
			`Photograph of ${ACONCAGUA.name}`
		);
		await expect(viewer(page).getByText(ACONCAGUA_PHOTO.author)).toBeVisible();
		await expect(viewer(page).getByRole('link', { name: ACONCAGUA_PHOTO.license })).toHaveAttribute(
			'href',
			ACONCAGUA_PHOTO.licenseUrl
		);
		await expect(viewer(page).getByRole('link', { name: ACONCAGUA_PHOTO.author })).toHaveAttribute(
			'href',
			ACONCAGUA_PHOTO.sourcePageUrl
		);
		expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
		expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');
		await expect.poll(() => watched.requested.some((request) => request.width === 1280)).toBe(true);
		await expect(viewer(page).getByRole('img')).toHaveAttribute('src', /\/1280px-/);

		await page.keyboard.press('Escape');
		await expect(page.locator('dialog')).toHaveCount(0);
		await expect(page.locator('main > [data-probe="untouched"]')).toHaveCount(1);
		expect(await stage.innerHTML()).toBe(stageBefore);
		expect(watched.pageErrors).toEqual([]);
	});

	test('closes with Escape, the Close button or a click outside, restoring focus and scroll', async ({
		page
	}) => {
		await watch(page);
		await open(page, ACONCAGUA.slug);
		await expect(openButton(page)).toBeEnabled();

		const closers = [
			() => page.keyboard.press('Escape'),
			() => viewer(page).getByRole('button', { name: 'Close' }).click(),
			() => viewer(page).click({ position: { x: 8, y: 400 } })
		];

		for (const close of closers) {
			await openButton(page).click();
			await expect(viewer(page)).toBeVisible();

			await close();

			await expect(page.locator('dialog')).toHaveCount(0);
			await expect(openButton(page)).toBeFocused();
			expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
		}
	});

	test('does not close when the photograph or its credit is clicked', async ({ page }) => {
		await watch(page);
		await open(page, ACONCAGUA.slug);
		await expect(openButton(page)).toBeEnabled();
		await openButton(page).click();

		await viewer(page).getByRole('img').click();
		await viewer(page).getByText(ACONCAGUA_PHOTO.author).click();

		await expect(viewer(page)).toBeVisible();
	});

	test('closes when the route moves on, so it never shows the previous mountain', async ({
		page
	}) => {
		await watch(page);
		await open(page, ACONCAGUA.slug);
		await expect(openButton(page)).toBeEnabled();
		await openButton(page).click();
		await expect(viewer(page)).toBeVisible();

		await navigate(page, OLYMPUS.name, OLYMPUS.slug);

		await expect(page.locator('dialog')).toHaveCount(0);
		await expect(frame(page)).toHaveAttribute('data-state', 'ready');
	});

	test('is operated by keyboard: named, focus enters, Tab stays inside, Escape returns focus', async ({
		page
	}) => {
		await watch(page);
		await open(page, ACONCAGUA.slug);
		await expect(openButton(page)).toBeEnabled();

		await openButton(page).focus();
		await page.keyboard.press('Enter');

		const dialog = viewer(page);
		await expect(dialog).toBeVisible();
		await expect(dialog).toHaveAccessibleName(`Photograph of ${ACONCAGUA.name}`);
		await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();

		// A native modal dialog hands focus to the browser UI after its last control and back to its
		// first: the page behind it must never receive focus (it is inert), whichever way Tab goes.
		const place = () =>
			page.evaluate(() => {
				const active = document.activeElement;
				if (active === document.body) return 'browser-ui';
				return active?.closest('dialog[open]') ? (active.textContent ?? '').trim() : 'page';
			});
		const visited = new Set<string>();
		const keys = [...Array<string>(8).fill('Tab'), ...Array<string>(8).fill('Shift+Tab')];
		for (const key of keys) {
			await page.keyboard.press(key);
			visited.add(await place());
		}

		expect(visited.has('page')).toBe(false);
		expect(visited).toContain(ACONCAGUA_PHOTO.license);
		expect(visited).toContain(ACONCAGUA_PHOTO.author);
		expect(visited).toContain('Close');

		await page.keyboard.press('Escape');
		await expect(page.locator('dialog')).toHaveCount(0);
		await expect(openButton(page)).toBeFocused();
	});

	test('leaves the page interactive after a route change closed it', async ({ page }) => {
		await watch(page);
		await open(page, ACONCAGUA.slug);
		await expect(openButton(page)).toBeEnabled();
		await openButton(page).click();
		await expect(viewer(page)).toBeVisible();

		await navigate(page, OLYMPUS.name, OLYMPUS.slug);

		await expect(page.locator('dialog')).toHaveCount(0);
		expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
		await expect(frame(page)).toHaveAttribute('data-state', 'ready');
		await page.keyboard.press('Tab');
		const reachable = await page.evaluate(() => {
			const active = document.activeElement;
			return active !== document.body && active?.closest('header, main, footer') !== null;
		});
		expect(reachable).toBe(true);
	});
});

test.describe('@nogl Photograph focus visibility', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test('rings the photograph control in two tones, whatever the photograph shows', async ({
		page
	}) => {
		await watch(page);
		await open(page, ACONCAGUA.slug);
		await expect(openButton(page)).toBeEnabled();

		await openButton(page).focus();
		await page.keyboard.press('Tab');
		await page.keyboard.press('Shift+Tab');
		await expect(openButton(page)).toBeFocused();

		const ring = await openButton(page).evaluate((node) => {
			const style = getComputedStyle(node);
			return {
				style: style.outlineStyle,
				width: style.outlineWidth,
				color: style.outlineColor,
				shadow: style.boxShadow
			};
		});
		expect(ring.style).toBe('solid');
		expect(ring.width).toBe('3px');
		expect(ring.color).toBe('rgb(247, 248, 245)');
		expect(ring.shadow).toContain('rgb(11, 18, 25)');
		expect(ring.shadow).toContain('inset');
	});
});

test.describe('@nogl Photograph motion preference', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	const durations = (page: Page) =>
		frame(page).evaluate((node) => {
			const mark = node.querySelector('svg');
			return {
				image: getComputedStyle(node.querySelector('img')!).transitionDuration,
				mark: mark ? getComputedStyle(mark).transitionDuration : undefined
			};
		});

	for (const [preference, expected] of [
		['no-preference', '0.18s'],
		['reduce', '0s']
	] as const) {
		test(`reveals the photograph with ${preference === 'reduce' ? 'no fade' : 'its fade'} and reaches the same final state`, async ({
			page
		}) => {
			await watch(page);
			await page.emulateMedia({ reducedMotion: preference });

			await open(page, ACONCAGUA.slug);

			await expect(frame(page)).toHaveAttribute('data-state', 'ready');
			expect(await durations(page)).toEqual({ image: expected, mark: expected });
			await expect(photo(page)).toHaveCSS('opacity', '1');
			await expect(openButton(page)).toBeEnabled();
		});
	}
});
