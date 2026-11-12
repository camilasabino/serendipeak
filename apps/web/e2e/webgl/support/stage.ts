import { expect, test as base, type Page, type Route } from '@playwright/test';
import { fixture } from '../../ssr/support';
import { TERRAIN_LAYER, flatTerrainTile } from './terrain';

export interface CanonicalCamera {
	headingDegrees: number;
	pitchDegrees: number;
	rangeMeters: number;
	framing?: { x: number; y: number };
}

export interface CameraReading extends CanonicalCamera {
	displayRangeMeters: number;
	stage: { width: number; height: number };
}

export interface ContractMountain {
	slug: string;
	name: string;
	camera: CanonicalCamera;
}

export const ACONCAGUA = fixture<ContractMountain>('mountain-complete.json');
export const OLYMPUS = fixture<ContractMountain>('mountain-sparse.json');
// No stored camera: the pose is derived, so tests identify it by route and heading only.
export const BARE_PEAK = fixture<Pick<ContractMountain, 'slug' | 'name'>>('mountain-minimal.json');

// BF-SCENE02 tolerances for a rendered canonical pose.
export const CAMERA_TOLERANCE = {
	angleDegrees: 0.5,
	rangeFraction: 0.005,
	framing: 0.01
} as const;

export const TERRAIN_HOST = 'https://terrain.e2e.invalid/';
export const IMAGERY_HOST = 'https://imagery.e2e.invalid/';
const PNG_PIXEL = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64'
);
const PHOTO_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#4f6a7a"/></svg>';

export interface StageProbe {
	/** Requests to hosts the suite did not mock; each one was aborted. */
	externalRequests(): string[];
	/** Local requests that failed or answered 4xx/5xx, plus mocked ones that did. */
	failedRequests(): string[];
	/** Console errors and uncaught page errors. */
	errors(): string[];
	/** Number of WebGL contexts the page created. */
	webglContexts(): Promise<number>;
	/** ResizeObserver activity on elements inside the page's main landmark. */
	stageObservers(): Promise<{ observed: number; live: number }>;
	/** Declares failures a test causes on purpose; everything else still fails the test. */
	tolerate(expected: { requests?: RegExp; errors?: RegExp }): void;
	/** What a failed test leaves behind in CI logs: page state, GL driver, console and requests. */
	diagnostics(): Promise<string>;
}

function isLocal(url: URL): boolean {
	return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

export async function isolateStage(page: Page): Promise<StageProbe> {
	const external: string[] = [];
	const failed: string[] = [];
	const errors: string[] = [];
	const consoleLog: string[] = [];
	const tolerated: { requests: RegExp[]; errors: RegExp[] } = { requests: [], errors: [] };

	await page.addInitScript(() => {
		const original = HTMLCanvasElement.prototype.getContext;
		const counter = { contexts: 0, observed: 0, live: new Set<ResizeObserver>() };
		(window as Window & { __stageProbe?: typeof counter }).__stageProbe = counter;
		const observe = ResizeObserver.prototype.observe;
		const disconnect = ResizeObserver.prototype.disconnect;
		ResizeObserver.prototype.observe = function (this: ResizeObserver, target, options) {
			if (target.closest('main')) {
				counter.observed += 1;
				counter.live.add(this);
			}
			return observe.call(this, target, options);
		};
		ResizeObserver.prototype.disconnect = function (this: ResizeObserver) {
			counter.live.delete(this);
			return disconnect.call(this);
		};
		HTMLCanvasElement.prototype.getContext = function (
			this: HTMLCanvasElement,
			...args: Parameters<typeof original>
		) {
			if (String(args[0]).includes('webgl')) {
				counter.contexts += 1;
			}
			return original.apply(this, args);
		} as typeof original;
	});

	await page.route(
		(url) => !isLocal(url),
		async (route) => {
			external.push(route.request().url());
			await route.abort('blockedbyclient');
		}
	);
	await page.route('https://api.cesium.com/v1/assets/1/endpoint**', (route) =>
		route.fulfill({
			json: { type: 'TERRAIN', url: TERRAIN_HOST, accessToken: 'e2e', attributions: [] }
		})
	);
	await page.route(`${TERRAIN_HOST}**`, async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith('/layer.json')) {
			await route.fulfill({ json: TERRAIN_LAYER });
			return;
		}
		const [, level, x, y] = /\/(\d+)\/(\d+)\/(\d+)\.terrain$/.exec(path) ?? [];
		await route.fulfill({
			contentType: 'application/octet-stream',
			body: flatTerrainTile(Number(level), Number(x), Number(y))
		});
	});
	await page.route('https://api.cesium.com/v1/assets/3954/endpoint**', (route) =>
		route.fulfill({
			json: {
				type: 'IMAGERY',
				externalType: 'URL_TEMPLATE',
				options: { url: `${IMAGERY_HOST}{z}/{x}/{y}.png` },
				attributions: []
			}
		})
	);
	await page.route(`${IMAGERY_HOST}**`, (route: Route) =>
		route.fulfill({ contentType: 'image/png', body: PNG_PIXEL })
	);
	await page.route(/^https:\/\/(upload|thumb)\.wikimedia\.org\//, (route) =>
		route.fulfill({ contentType: 'image/svg+xml', body: PHOTO_SVG })
	);

	page.on('requestfailed', (request) => {
		if (!external.includes(request.url())) {
			failed.push(`${request.url()} (${request.failure()?.errorText ?? 'failed'})`);
		}
	});
	page.on('response', (response) => {
		if (response.status() >= 400) {
			failed.push(`${response.url()} (${response.status()})`);
		}
	});
	page.on('console', (message) => {
		consoleLog.push(`${message.type()}: ${message.text()}`);
		if (message.type() === 'error') {
			errors.push(message.text());
		}
	});
	page.on('pageerror', (error) => errors.push(error.message));

	return {
		externalRequests: () => [...external],
		failedRequests: () => failed.filter((entry) => !tolerated.requests.some((p) => p.test(entry))),
		errors: () => errors.filter((entry) => !tolerated.errors.some((p) => p.test(entry))),
		tolerate: ({ requests, errors: messages }) => {
			if (requests) tolerated.requests.push(requests);
			if (messages) tolerated.errors.push(messages);
		},
		diagnostics: () => describePage(page, { console: consoleLog, failed, external }),
		webglContexts: () =>
			page.evaluate(
				() =>
					(window as Window & { __stageProbe?: { contexts: number } }).__stageProbe?.contexts ?? 0
			),
		stageObservers: () =>
			page.evaluate(() => {
				const probe = (
					window as Window & { __stageProbe?: { observed: number; live: Set<unknown> } }
				).__stageProbe;
				return { observed: probe?.observed ?? 0, live: probe?.live.size ?? 0 };
			})
	};
}

const DIAGNOSTIC_TIMEOUT_MS = 5_000;
const CONSOLE_TAIL = 40;

interface PageRecord {
	console: string[];
	failed: string[];
	external: string[];
}

// A hung page must not hang the report, and nothing here may fail the test it describes.
async function bounded<T>(read: () => Promise<T>): Promise<T | string> {
	let timer: NodeJS.Timeout | undefined;
	const expired = new Promise<string>((resolve) => {
		timer = setTimeout(() => resolve('(page did not answer)'), DIAGNOSTIC_TIMEOUT_MS);
	});
	try {
		return await Promise.race([read(), expired]);
	} catch (error) {
		return `(unavailable: ${error instanceof Error ? error.message.split('\n')[0] : String(error)})`;
	} finally {
		clearTimeout(timer);
	}
}

async function describePage(page: Page, record: PageRecord): Promise<string> {
	const graphics = await bounded(() =>
		page.evaluate(() => {
			const canvas = document.querySelector('canvas');
			const context = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl') ?? undefined;
			if (!canvas) {
				return 'no canvas';
			}
			if (!context) {
				return 'canvas has no WebGL context';
			}
			const info = context.getExtension('WEBGL_debug_renderer_info');

			return {
				lost: context.isContextLost(),
				renderer: info ? context.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'masked',
				maxTextureSize: context.getParameter(context.MAX_TEXTURE_SIZE),
				drawingBuffer: `${context.drawingBufferWidth}x${context.drawingBufferHeight}`,
				devicePixelRatio: window.devicePixelRatio
			};
		})
	);
	const regions = await bounded(() =>
		page.evaluate(() => ({
			statuses: [...document.querySelectorAll('[role="status"]')].map((e) => e.textContent?.trim()),
			alerts: [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent?.trim()),
			resetControl: document.body.textContent?.includes('Reset view') ?? false,
			camera: (window as Window & { __serendipeakCamera?: () => unknown }).__serendipeakCamera?.()
		}))
	);

	return [
		`url: ${page.url()}`,
		`graphics: ${JSON.stringify(graphics)}`,
		`regions: ${JSON.stringify(regions)}`,
		`failed requests: ${JSON.stringify(record.failed)}`,
		`unmocked external requests: ${JSON.stringify(record.external)}`,
		`console (last ${CONSOLE_TAIL}):`,
		...record.console.slice(-CONSOLE_TAIL).map((line) => `  ${line}`)
	].join('\n');
}

type Fixtures = { probe: StageProbe };

export const test = base.extend<Fixtures>({
	probe: [
		async ({ page }, use, testInfo) => {
			const probe = await isolateStage(page);
			await use(probe);

			if (testInfo.status !== testInfo.expectedStatus) {
				console.log(`\n[stage diagnostics] ${testInfo.title}\n${await probe.diagnostics()}\n`);
			}
			expect(probe.externalRequests(), 'unmocked external requests').toEqual([]);
			expect(probe.failedRequests(), 'failed requests').toEqual([]);
			expect(probe.errors(), 'console and page errors').toEqual([]);
		},
		{ auto: true }
	]
});

export { expect };

export async function expectReadyStage(page: Page) {
	// The loader may not be discoverable by role yet during SSR and hydration, so its absence alone
	// proves nothing; the Reset control only becomes enabled once the stage is interactive.
	await expect(page.getByRole('button', { name: 'Reset view' })).toBeEnabled({ timeout: 60_000 });
	// The stage's own status region stays mounted but empty; only the loader fills one before ready.
	await expect(page.getByRole('status').filter({ hasText: /\S/ })).toHaveCount(0);
	// Next's route announcer is also an alert, so only the stage's own failure notice counts.
	await expect(page.locator('main [role="alert"]')).toHaveCount(0);
}

export async function liveViewers(page: Page) {
	return page.evaluate(() => ({
		canvases: document.querySelectorAll('canvas').length,
		viewers: document.querySelectorAll('.cesium-viewer').length
	}));
}

export async function cameraReading(page: Page): Promise<CameraReading | undefined> {
	return page.evaluate(
		() =>
			(
				window as Window & { __serendipeakCamera?: () => CameraReading | undefined }
			).__serendipeakCamera?.() ?? undefined
	);
}

function angleDelta(a: number, b: number): number {
	const delta = Math.abs((((a - b) % 360) + 360) % 360);
	return delta > 180 ? 360 - delta : delta;
}

export interface GlobePosition {
	latitude: number;
	longitude: number;
	heightMeters: number;
	distanceFromCenterMeters: number;
	orbiting: boolean;
}

export async function globePosition(page: Page): Promise<GlobePosition | undefined> {
	return page.evaluate(
		() =>
			(
				window as Window & { __serendipeakGlobe?: () => GlobePosition | undefined }
			).__serendipeakGlobe?.() ?? undefined
	);
}

/** Resolves after the page has rendered this many animation frames: a signal, not a sleep. */
export async function framesPass(page: Page, frames = 30): Promise<void> {
	await page.evaluate(
		(count) =>
			new Promise<void>((resolve) => {
				let seen = 0;
				const next = () => (++seen >= count ? resolve() : requestAnimationFrame(next));
				requestAnimationFrame(next);
			}),
		frames
	);
}

export function poseDifference(
	reading: CameraReading | undefined,
	canonical: CanonicalCamera
): string | undefined {
	if (!reading) {
		return 'no camera reading';
	}
	const framing = reading.framing ?? { x: 0, y: 0 };
	const expected = canonical.framing ?? { x: 0, y: 0 };
	const checks: [string, boolean][] = [
		[
			'heading',
			angleDelta(reading.headingDegrees, canonical.headingDegrees) <= CAMERA_TOLERANCE.angleDegrees
		],
		[
			'pitch',
			Math.abs(reading.pitchDegrees - canonical.pitchDegrees) <= CAMERA_TOLERANCE.angleDegrees
		],
		[
			'range',
			Math.abs(reading.rangeMeters - canonical.rangeMeters) <=
				canonical.rangeMeters * CAMERA_TOLERANCE.rangeFraction
		],
		['framing.x', Math.abs(framing.x - expected.x) <= CAMERA_TOLERANCE.framing],
		['framing.y', Math.abs(framing.y - expected.y) <= CAMERA_TOLERANCE.framing]
	];
	const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);

	return failed.length === 0 ? undefined : `${failed.join(', ')} off: ${JSON.stringify(reading)}`;
}

export async function expectCanonicalPose(page: Page, canonical: CanonicalCamera) {
	await expect
		.poll(async () => poseDifference(await cameraReading(page), canonical), { timeout: 30_000 })
		.toBeUndefined();
}

// BF-SCENE02: the effective range is the base range times clamp(1.35 / aspect, 0.85, 1.25).
export function expectedDisplayRange(base: number, stage: { width: number; height: number }) {
	const scale = Math.min(1.25, Math.max(0.85, 1.35 / (stage.width / stage.height)));

	return base * scale;
}
