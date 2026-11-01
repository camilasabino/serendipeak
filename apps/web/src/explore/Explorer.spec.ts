import { describe, expect, it, vi } from 'vitest';
import type { Mountain, RandomMountainResult } from '../api/contract';
import { contractFixture } from '../api/test-support/contractFixtures';
import { FakeMountainApi } from '../api/test-support/FakeMountainApi';
import { ImagePreloader, type PreloadableImage } from '../media/preload';
import type { SceneTarget } from '../stage/globe/camera';
import type { PresentationOutcome } from '../stage/SceneSession';
import { TransitionCoordinator, type Transition } from '../stage/TransitionCoordinator';
import { createDeferred, type Deferred } from '../test/FakeGlobeScene';
import { Explorer, type ExploreState } from './Explorer';

const ACONCAGUA = contractFixture('mountain-complete.json') as Mountain;
const OLYMPUS = contractFixture('mountain-sparse.json') as Mountain;
const BARE_PEAK = contractFixture('mountain-minimal.json') as Mountain;

function target(mountain: Mountain): SceneTarget {
	return {
		slug: mountain.slug,
		name: mountain.name,
		latitude: mountain.coordinates.latitude,
		longitude: mountain.coordinates.longitude,
		elevationMeters: mountain.elevationMeters
	};
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

class FakeImage extends EventTarget implements PreloadableImage {
	complete = false;
	naturalWidth = 0;
	naturalHeight = 0;
	currentSrc = '';
	sizes = '';
	srcset = '';
	src = '';
}

interface Setup {
	api?: FakeMountainApi;
	navigate?: (slug: string) => Promise<boolean>;
	onError?: (error: unknown) => void;
	onNavigated?: (slug: string) => void;
}

function setup(options: Setup = {}) {
	const api = options.api ?? new FakeMountainApi({ random: { kind: 'found', mountain: OLYMPUS } });
	const coordinator = new TransitionCoordinator();
	const images: FakeImage[] = [];
	const preloader = new ImagePreloader({
		create: () => {
			const image = new FakeImage();
			images.push(image);
			return image;
		}
	});
	const navigations: string[] = [];
	const navigate =
		options.navigate ??
		(async (slug: string) => {
			navigations.push(slug);
			return true;
		});
	const onError = options.onError ?? vi.fn();
	const onNavigated = options.onNavigated ?? vi.fn();
	const explorer = new Explorer({ api, coordinator, preloader, navigate, onNavigated, onError });
	const states: ExploreState[] = [];
	explorer.subscribe(() => states.push(explorer.getSnapshot()));

	return {
		api,
		coordinator,
		explorer,
		images,
		navigations,
		onError,
		onNavigated,
		preloader,
		states
	};
}

// The scene reports what the destination page makes it present, as the real session does.
function travelTo(
	coordinator: TransitionCoordinator,
	mountain: Mountain,
	outcome: PresentationOutcome = 'arrived'
) {
	coordinator.presenting(target(mountain));
	coordinator.presented(target(mountain), outcome);
}

function pendingNavigation() {
	const navigation: Deferred<boolean> = createDeferred<boolean>();
	const requested: string[] = [];
	return {
		navigation,
		requested,
		navigate: (slug: string) => {
			requested.push(slug);
			return navigation.promise;
		}
	};
}

describe('Explorer', () => {
	it('starts idle', () => {
		const { explorer } = setup();

		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
	});

	it('asks for a mountain other than the current one, once per activation', async () => {
		const { api, explorer, coordinator } = setup();

		const exploring = explorer.explore('aconcagua');
		await flush();
		travelTo(coordinator, OLYMPUS);
		await exploring;

		expect(api.getRandomMountainCalls).toEqual(['aconcagua']);
	});

	it('is busy from the click until the scene settled on the destination', async () => {
		const { explorer, coordinator, navigations } = setup();

		const exploring = explorer.explore('aconcagua');
		expect(explorer.getSnapshot()).toEqual({ status: 'loading' });
		await flush();

		expect(navigations).toEqual(['mount-olympus']);
		expect(explorer.getSnapshot()).toEqual({ status: 'loading' });

		travelTo(coordinator, OLYMPUS);
		await exploring;
		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
	});

	it('explores again from the mountain it arrived at', async () => {
		const api = new FakeMountainApi({ random: { kind: 'found', mountain: OLYMPUS } });
		const { explorer, coordinator } = setup({ api });
		const first = explorer.explore('aconcagua');
		await flush();
		travelTo(coordinator, OLYMPUS);
		await first;

		const second = explorer.explore('mount-olympus');
		await flush();
		travelTo(coordinator, OLYMPUS);
		await second;

		expect(api.getRandomMountainCalls).toEqual(['aconcagua', 'mount-olympus']);
	});
});

describe('Explorer repeated activation', () => {
	it('ignores activations while a mountain is being fetched', async () => {
		const api = new FakeMountainApi();
		const pending = createDeferred<RandomMountainResult>();
		api.getRandomMountain = (exclude) => {
			api.getRandomMountainCalls.push(exclude);
			return pending.promise;
		};
		const { explorer } = setup({ api });

		void explorer.explore('aconcagua');
		void explorer.explore('aconcagua');
		void explorer.explore('aconcagua');

		expect(api.getRandomMountainCalls).toEqual(['aconcagua']);
	});

	it('ignores activations while the scene is still travelling', async () => {
		const { api, explorer, coordinator } = setup();
		const exploring = explorer.explore('aconcagua');
		await flush();

		await explorer.explore('aconcagua');
		await explorer.explore('aconcagua');
		travelTo(coordinator, OLYMPUS);
		await exploring;

		expect(api.getRandomMountainCalls).toEqual(['aconcagua']);
	});

	it('ignores activations while the navigation is in flight', async () => {
		const { navigate, requested, navigation } = pendingNavigation();
		const { api, explorer, coordinator } = setup({ navigate });
		const exploring = explorer.explore('aconcagua');
		await flush();

		void explorer.explore('aconcagua');
		navigation.resolve(true);
		travelTo(coordinator, OLYMPUS);
		await exploring;

		expect(api.getRandomMountainCalls).toHaveLength(1);
		expect(requested).toEqual(['mount-olympus']);
	});
});

describe('Explorer failures', () => {
	it.each([
		[{ kind: 'unreachable' }, 'Mountain data is unavailable right now. Try again.'],
		[{ kind: 'api-error' }, 'Another mountain could not be loaded. Try again.'],
		[{ kind: 'no-eligible-mountains' }, 'No mountain is available right now.']
	] as [RandomMountainResult, string][])(
		'reports %j with its own message, without navigating',
		async (result, message) => {
			const { explorer, navigations, onError } = setup({
				api: new FakeMountainApi({ random: result })
			});

			await explorer.explore('aconcagua');

			expect(explorer.getSnapshot()).toEqual({ status: 'failed', message, from: 'aconcagua' });
			expect(navigations).toEqual([]);
			expect(onError).not.toHaveBeenCalled();
		}
	);

	it('never exposes raw status codes or error text', async () => {
		const { explorer } = setup({
			api: new FakeMountainApi({
				random: { kind: 'api-error', status: 500 } as RandomMountainResult
			})
		});

		await explorer.explore('aconcagua');

		const snapshot = explorer.getSnapshot();
		expect(JSON.stringify(snapshot)).not.toMatch(/500|Error|stack/);
	});

	it('succeeds on retry after a failure', async () => {
		const api = new FakeMountainApi({ random: { kind: 'unreachable' } });
		const { explorer, coordinator } = setup({ api });
		await explorer.explore('aconcagua');
		expect(explorer.getSnapshot().status).toBe('failed');

		Object.assign(api, {
			getRandomMountain: async (): Promise<RandomMountainResult> => ({
				kind: 'found',
				mountain: OLYMPUS
			})
		});
		const retry = explorer.explore('aconcagua');
		expect(explorer.getSnapshot()).toEqual({ status: 'loading' });
		await flush();
		travelTo(coordinator, OLYMPUS);
		await retry;

		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
	});

	it('reports a rejected lookup as a local failure and observes the error', async () => {
		const boom = new Error('network layer bug');
		const api = new FakeMountainApi();
		api.getRandomMountain = () => Promise.reject(boom);
		const { explorer, onError } = setup({ api });

		await expect(explorer.explore('aconcagua')).resolves.toBeUndefined();

		expect(explorer.getSnapshot()).toEqual({
			status: 'failed',
			message: 'Another mountain could not be loaded. Try again.',
			from: 'aconcagua'
		});
		expect(onError).toHaveBeenCalledExactlyOnceWith(boom);
	});

	it('reports a rejected navigation as a local failure and observes the error', async () => {
		const boom = new Error('navigation bug');
		const { explorer, onError } = setup({ navigate: () => Promise.reject(boom) });

		await explorer.explore('aconcagua');

		expect(explorer.getSnapshot()).toMatchObject({
			status: 'failed',
			message: 'Another mountain could not be loaded. Try again.'
		});
		expect(onError).toHaveBeenCalledExactlyOnceWith(boom);
	});

	it('releases its transition when the navigation fails', async () => {
		const coordinator = new TransitionCoordinator();
		const transitions: Transition[] = [];
		const begin = coordinator.begin.bind(coordinator);
		coordinator.begin = (destination) => {
			const transition = begin(destination);
			transitions.push(transition);
			return transition;
		};
		const explorer = new Explorer({
			api: new FakeMountainApi({ random: { kind: 'found', mountain: OLYMPUS } }),
			coordinator,
			preloader: new ImagePreloader({ create: () => undefined }),
			navigate: () => Promise.reject(new Error('navigation bug')),
			onError: () => {}
		});

		await explorer.explore('aconcagua');

		await expect(transitions[0]?.arrival).resolves.toBe('interrupted');
	});

	it('abandons its transition when the navigation fails, so a late arrival is ignored', async () => {
		const { explorer, coordinator } = setup({ navigate: () => Promise.reject(new Error('x')) });
		await explorer.explore('aconcagua');

		travelTo(coordinator, OLYMPUS);

		expect(explorer.getSnapshot().status).toBe('failed');
	});

	it('returns to idle, without a failure, when the navigation was cancelled by a newer one', async () => {
		const { explorer, onError } = setup({ navigate: async () => false });

		await explorer.explore('aconcagua');

		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
		expect(onError).not.toHaveBeenCalled();
	});

	it('returns to idle, without a failure, when the camera failed after the page changed', async () => {
		const { explorer, coordinator, onError } = setup();
		const exploring = explorer.explore('aconcagua');
		await flush();

		travelTo(coordinator, OLYMPUS, 'failed');
		await exploring;

		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
		expect(onError).not.toHaveBeenCalled();
	});

	it('reports the shown destination once, before the camera finishes', async () => {
		const { explorer, coordinator, onNavigated } = setup();
		const exploring = explorer.explore('aconcagua');
		await flush();

		expect(onNavigated).toHaveBeenCalledTimes(1);
		expect(onNavigated).toHaveBeenCalledWith(OLYMPUS.slug);
		expect(explorer.getSnapshot()).toEqual({ status: 'loading' });

		travelTo(coordinator, OLYMPUS);
		await exploring;

		expect(onNavigated).toHaveBeenCalledTimes(1);
	});

	it('still reports the destination when the camera then fails', async () => {
		const { explorer, coordinator, onNavigated } = setup();
		const exploring = explorer.explore('aconcagua');
		await flush();

		travelTo(coordinator, OLYMPUS, 'failed');
		await exploring;

		expect(onNavigated).toHaveBeenCalledTimes(1);
	});

	it('reports nothing when the lookup fails, the navigation was replaced or the page did not change', async () => {
		const failed = setup({ api: new FakeMountainApi({ random: { kind: 'unreachable' } }) });
		await failed.explorer.explore('aconcagua');

		const replaced = setup({ navigate: async () => false });
		await replaced.explorer.explore('aconcagua');

		const same = setup({
			api: new FakeMountainApi({ random: { kind: 'found', mountain: ACONCAGUA } })
		});
		const exploring = same.explorer.explore('aconcagua');
		await flush();
		travelTo(same.coordinator, ACONCAGUA);
		await exploring;

		expect(failed.onNavigated).not.toHaveBeenCalled();
		expect(replaced.onNavigated).not.toHaveBeenCalled();
		expect(same.onNavigated).not.toHaveBeenCalled();
	});

	it('reports nothing for a run that a route change superseded while it navigated', async () => {
		const pending = pendingNavigation();
		const { explorer, onNavigated } = setup({ navigate: pending.navigate });
		const exploring = explorer.explore('aconcagua');
		await flush();

		explorer.routeChangeStarted('/somewhere-else');
		pending.navigation.resolve(true);
		await exploring;

		expect(onNavigated).not.toHaveBeenCalled();
	});

	it('survives an observer that throws, reporting it without failing the exploration', async () => {
		const failure = new Error('focus failed');
		const { explorer, coordinator, onError } = setup({
			onNavigated: () => {
				throw failure;
			}
		});
		const exploring = explorer.explore('aconcagua');
		await flush();

		travelTo(coordinator, OLYMPUS);
		await exploring;

		expect(onError).toHaveBeenCalledWith(failure);
		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
	});

	it('returns to idle, without a failure, when the scene session ended mid-transition', async () => {
		const { explorer, coordinator, onError } = setup();
		const exploring = explorer.explore('aconcagua');
		await flush();

		coordinator.ended();
		await exploring;

		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
		expect(onError).not.toHaveBeenCalled();
	});

	it('does not wait for a scene that will never travel on a failed stage', async () => {
		const { explorer, coordinator } = setup();
		const exploring = explorer.explore('aconcagua');
		await flush();

		coordinator.ended();

		await expect(exploring).resolves.toBeUndefined();
	});
});

describe('Explorer supersession', () => {
	it('returns to idle, without a failure, when another destination takes over the scene', async () => {
		const { explorer, coordinator, onError } = setup();
		const exploring = explorer.explore('aconcagua');
		await flush();

		coordinator.presenting(target(ACONCAGUA));
		await exploring;

		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
		expect(onError).not.toHaveBeenCalled();
	});

	it('is usable again as soon as it was superseded', async () => {
		const api = new FakeMountainApi({ random: { kind: 'found', mountain: OLYMPUS } });
		const { explorer, coordinator } = setup({ api });
		const first = explorer.explore('aconcagua');
		await flush();
		coordinator.presenting(target(ACONCAGUA));
		await first;

		const second = explorer.explore('aconcagua');
		await flush();
		travelTo(coordinator, OLYMPUS);
		await second;

		expect(api.getRandomMountainCalls).toEqual(['aconcagua', 'aconcagua']);
		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
	});
});

describe('Explorer cancellation', () => {
	it('does not navigate or report when cancelled before the response arrives', async () => {
		const api = new FakeMountainApi();
		const pending = createDeferred<RandomMountainResult>();
		api.getRandomMountain = () => pending.promise;
		const { explorer, navigations, images, states } = setup({ api });
		const exploring = explorer.explore('aconcagua');

		explorer.cancel();
		pending.resolve({ kind: 'found', mountain: OLYMPUS });
		await exploring;

		expect(navigations).toEqual([]);
		expect(images).toEqual([]);
		expect(states.map((state) => state.status)).toEqual(['loading', 'idle']);
	});

	it('does not report a failure that arrives after cancel', async () => {
		const api = new FakeMountainApi();
		const pending = createDeferred<RandomMountainResult>();
		api.getRandomMountain = () => pending.promise;
		const { explorer } = setup({ api });
		const exploring = explorer.explore('aconcagua');

		explorer.cancel();
		pending.resolve({ kind: 'unreachable' });
		await exploring;

		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
	});

	it('releases a transition that is travelling, and ignores its late arrival', async () => {
		const { explorer, coordinator, states } = setup();
		const exploring = explorer.explore('aconcagua');
		await flush();

		explorer.cancel();
		travelTo(coordinator, OLYMPUS);
		await exploring;

		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
		expect(states.map((state) => state.status)).toEqual(['loading', 'idle']);
	});

	it('does not let a cancelled run free the control of the run that replaced it', async () => {
		const api = new FakeMountainApi({ random: { kind: 'found', mountain: OLYMPUS } });
		const { explorer, coordinator } = setup({ api });
		const first = explorer.explore('aconcagua');
		await flush();
		explorer.cancel();

		const second = explorer.explore('aconcagua');
		await first;
		expect(explorer.getSnapshot()).toEqual({ status: 'loading' });
		await flush();
		travelTo(coordinator, OLYMPUS);
		await second;

		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
	});

	it('can explore again after a cancel, as a remounted control does', async () => {
		const api = new FakeMountainApi({ random: { kind: 'found', mountain: OLYMPUS } });
		const { explorer, coordinator } = setup({ api });
		explorer.cancel();

		const exploring = explorer.explore('aconcagua');
		await flush();
		travelTo(coordinator, OLYMPUS);
		await exploring;

		expect(api.getRandomMountainCalls).toEqual(['aconcagua']);
	});

	it('survives a cancel with nothing running', () => {
		const { explorer, states } = setup();

		expect(() => explorer.cancel()).not.toThrow();
		expect(states).toEqual([]);
	});
});

describe('Explorer navigation identity', () => {
	it('navigates to the destination once and reaches it through the coordinator', async () => {
		const { explorer, coordinator, navigations } = setup();
		const exploring = explorer.explore('aconcagua');
		await flush();

		travelTo(coordinator, OLYMPUS);
		await exploring;

		expect(navigations).toEqual(['mount-olympus']);
	});

	it('navigates once to the mountain the scene already shows, without waiting for travel', async () => {
		const api = new FakeMountainApi({ random: { kind: 'found', mountain: ACONCAGUA } });
		const { explorer, coordinator, navigations } = setup({ api });
		coordinator.presenting(target(ACONCAGUA));
		coordinator.presented(target(ACONCAGUA), 'arrived');

		await explorer.explore('aconcagua');

		expect(navigations).toEqual(['aconcagua']);
		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
	});

	it('begins its transition before the navigation starts, so no report can be missed', async () => {
		let arrivalSettledDuringNavigation: string | undefined;
		const api = new FakeMountainApi({ random: { kind: 'found', mountain: OLYMPUS } });
		const coordinator = new TransitionCoordinator();
		const explorer = new Explorer({
			api,
			coordinator,
			preloader: new ImagePreloader({ create: () => undefined }),
			navigate: async () => {
				// The page change makes the scene present the destination before push resolves.
				travelTo(coordinator, OLYMPUS);
				arrivalSettledDuringNavigation = 'arrived';
				return true;
			}
		});

		await explorer.explore('aconcagua');

		expect(arrivalSettledDuringNavigation).toBe('arrived');
		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
	});
});

describe('Explorer destination photo preload', () => {
	it('warms the destination photograph before the navigation starts', async () => {
		const order: string[] = [];
		const { explorer, coordinator, preloader } = setup({
			navigate: async () => {
				order.push('navigate');
				return true;
			}
		});
		const preload = vi.spyOn(preloader, 'preload').mockImplementation(() => {
			order.push('preload');
		});

		const exploring = explorer.explore('aconcagua');
		await flush();
		travelTo(coordinator, OLYMPUS);
		await exploring;

		expect(order).toEqual(['preload', 'navigate']);
		expect(preload).toHaveBeenCalledTimes(1);
	});

	it('preloads the destination primary photograph through the shared preloader', async () => {
		const { explorer, coordinator, images } = setup();

		const exploring = explorer.explore('aconcagua');
		await flush();
		travelTo(coordinator, OLYMPUS);
		await exploring;

		expect(images).toHaveLength(1);
		expect(images[0]?.src).toContain('wikimedia');
	});

	it('does not wait for the photograph to navigate or to settle', async () => {
		const { explorer, coordinator, images, navigations } = setup();

		const exploring = explorer.explore('aconcagua');
		await flush();
		expect(navigations).toEqual(['mount-olympus']);
		travelTo(coordinator, OLYMPUS);
		await exploring;

		expect(images[0]?.complete).toBe(false);
		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
	});

	it('does not preload for a destination without a photograph', async () => {
		const { explorer, coordinator, images } = setup({
			api: new FakeMountainApi({ random: { kind: 'found', mountain: BARE_PEAK } })
		});

		const exploring = explorer.explore('aconcagua');
		await flush();
		travelTo(coordinator, BARE_PEAK);
		await exploring;

		expect(images).toEqual([]);
	});

	it('still navigates, and observes the error, when the preload throws', async () => {
		const boom = new Error('preload bug');
		const { explorer, coordinator, navigations, onError, preloader } = setup();
		vi.spyOn(preloader, 'preload').mockImplementation(() => {
			throw boom;
		});

		const exploring = explorer.explore('aconcagua');
		await flush();
		travelTo(coordinator, OLYMPUS);
		await exploring;

		expect(navigations).toEqual(['mount-olympus']);
		expect(onError).toHaveBeenCalledExactlyOnceWith(boom);
		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
	});

	it('reuses one preloader across explorations of the same destination', async () => {
		const { explorer, coordinator, images } = setup();
		for (const from of ['aconcagua', 'aconcagua']) {
			const exploring = explorer.explore(from);
			await flush();
			travelTo(coordinator, OLYMPUS);
			await exploring;
		}

		expect(images).toHaveLength(1);
	});

	it('does not warm the photograph of a destination chosen after a cancel', async () => {
		const api = new FakeMountainApi();
		const pending = createDeferred<RandomMountainResult>();
		api.getRandomMountain = () => pending.promise;
		const { explorer, images } = setup({ api });
		const exploring = explorer.explore('aconcagua');

		explorer.cancel();
		pending.resolve({ kind: 'found', mountain: OLYMPUS });
		await exploring;

		expect(images).toEqual([]);
	});
});

describe('Explorer route supersession', () => {
	const OWN_ROUTE = '/mountains/mount-olympus';

	function pendingLookup() {
		const api = new FakeMountainApi();
		const lookup = createDeferred<RandomMountainResult>();
		api.getRandomMountain = (exclude) => {
			api.getRandomMountainCalls.push(exclude);
			return lookup.promise;
		};

		return { api, lookup };
	}

	it('lets a navigation that starts while the destination is being fetched win', async () => {
		const { api, lookup } = pendingLookup();
		const { explorer, navigations, images, onError, states } = setup({ api });
		const exploring = explorer.explore('aconcagua');

		explorer.routeChangeStarted('/mountains/aconcagua');
		lookup.resolve({ kind: 'found', mountain: OLYMPUS });
		await exploring;

		expect(navigations).toEqual([]);
		expect(images).toEqual([]);
		expect(onError).not.toHaveBeenCalled();
		expect(states.map((state) => state.status)).toEqual(['loading', 'idle']);
	});

	it('does not report a failure that arrives after a navigation took over', async () => {
		const { api, lookup } = pendingLookup();
		const { explorer, onError } = setup({ api });
		const exploring = explorer.explore('aconcagua');

		explorer.routeChangeStarted('/');
		lookup.resolve({ kind: 'api-error' } as RandomMountainResult);
		await exploring;

		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
		expect(onError).not.toHaveBeenCalled();
	});

	it('is usable again as soon as a navigation took over, before the lookup settles', async () => {
		const { api, lookup } = pendingLookup();
		const { explorer, states } = setup({ api });
		void explorer.explore('aconcagua');

		explorer.routeChangeStarted('/mountains/aconcagua');

		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
		expect(states.map((state) => state.status)).toEqual(['loading', 'idle']);
		lookup.resolve({ kind: 'found', mountain: OLYMPUS });
	});

	it('ignores the route change its own navigation causes', async () => {
		const { navigate, navigation } = pendingNavigation();
		const { explorer, coordinator, states } = setup({ navigate });
		const exploring = explorer.explore('aconcagua');
		await flush();

		explorer.routeChangeStarted(OWN_ROUTE);

		expect(explorer.getSnapshot()).toEqual({ status: 'loading' });
		navigation.resolve(true);
		travelTo(coordinator, OLYMPUS);
		await exploring;
		expect(states.map((state) => state.status)).toEqual(['loading', 'idle']);
	});

	it('lets a navigation that replaces its in-flight navigation win', async () => {
		const { navigate, navigation, requested } = pendingNavigation();
		const { explorer, coordinator, onError } = setup({ navigate });
		const exploring = explorer.explore('aconcagua');
		await flush();

		explorer.routeChangeStarted('/mountains/aconcagua');
		navigation.resolve(false);
		await exploring;
		travelTo(coordinator, ACONCAGUA);

		expect(requested).toEqual(['mount-olympus']);
		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
		expect(onError).not.toHaveBeenCalled();
	});

	it('releases its transition when a navigation takes over before the router settled', async () => {
		const { navigate, navigation } = pendingNavigation();
		const coordinator = new TransitionCoordinator();
		const transitions: Transition[] = [];
		const begin = coordinator.begin.bind(coordinator);
		coordinator.begin = (destination) => {
			const transition = begin(destination);
			transitions.push(transition);
			return transition;
		};
		const explorer = new Explorer({
			api: new FakeMountainApi({ random: { kind: 'found', mountain: OLYMPUS } }),
			coordinator,
			preloader: new ImagePreloader({ create: () => undefined }),
			navigate
		});
		const exploring = explorer.explore('aconcagua');
		await flush();

		explorer.routeChangeStarted('/mountains/aconcagua');
		navigation.resolve(true);
		await exploring;

		await expect(transitions[0]?.arrival).resolves.toBe('interrupted');
	});

	it('lets a navigation that starts while the scene is travelling win', async () => {
		const { explorer, coordinator, onError, states } = setup();
		const exploring = explorer.explore('aconcagua');
		await flush();
		coordinator.presenting(target(OLYMPUS));

		explorer.routeChangeStarted('/mountains/aconcagua');
		await exploring;

		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
		expect(states.map((state) => state.status)).toEqual(['loading', 'idle']);
		expect(onError).not.toHaveBeenCalled();
	});

	it('does nothing when no exploration is running', () => {
		const { explorer, states } = setup();

		explorer.routeChangeStarted('/mountains/aconcagua');

		expect(states).toEqual([]);
	});

	it('does not touch the run that replaced a superseded one', async () => {
		const api = new FakeMountainApi({ random: { kind: 'found', mountain: OLYMPUS } });
		const { explorer, coordinator } = setup({ api });
		void explorer.explore('aconcagua');
		explorer.routeChangeStarted('/mountains/aconcagua');
		const second = explorer.explore('aconcagua');
		await flush();

		explorer.routeChangeStarted(OWN_ROUTE);
		travelTo(coordinator, OLYMPUS);
		await second;

		expect(api.getRandomMountainCalls).toEqual(['aconcagua', 'aconcagua']);
		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
	});

	it('keeps observing a lookup failure that is not a cancellation, even when it arrives late', async () => {
		const boom = new Error('network layer bug');
		const api = new FakeMountainApi();
		const lookup = createDeferred<RandomMountainResult>();
		api.getRandomMountain = () => lookup.promise;
		const { explorer, onError } = setup({ api });
		const exploring = explorer.explore('aconcagua');
		explorer.routeChangeStarted('/mountains/aconcagua');

		lookup.reject(boom);
		await exploring;

		expect(onError).toHaveBeenCalledExactlyOnceWith(boom);
		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
	});

	it('is idempotent when a navigation and a disposal both cancel the same run', async () => {
		const { api, lookup } = pendingLookup();
		const { explorer, states } = setup({ api });
		const exploring = explorer.explore('aconcagua');

		explorer.routeChangeStarted('/mountains/aconcagua');
		explorer.cancel();
		explorer.cancel();
		lookup.resolve({ kind: 'found', mountain: OLYMPUS });
		await exploring;

		expect(states.map((state) => state.status)).toEqual(['loading', 'idle']);
	});
});

describe('Explorer disposal while busy', () => {
	it('stops a run waiting for the router, and ignores the route it reaches afterwards', async () => {
		const { navigate, navigation } = pendingNavigation();
		const { explorer, coordinator, states } = setup({ navigate });
		const exploring = explorer.explore('aconcagua');
		await flush();

		explorer.cancel();
		navigation.resolve(true);
		travelTo(coordinator, OLYMPUS);
		await exploring;

		expect(states.map((state) => state.status)).toEqual(['loading', 'idle']);
	});

	it('does not report a router failure that arrives after disposal as a local failure', async () => {
		const boom = new Error('router bug');
		const { navigate, navigation } = pendingNavigation();
		const { explorer, onError } = setup({ navigate });
		const exploring = explorer.explore('aconcagua');
		await flush();

		explorer.cancel();
		navigation.reject(boom);
		await exploring;

		expect(explorer.getSnapshot()).toEqual({ status: 'idle' });
		expect(onError).toHaveBeenCalledExactlyOnceWith(boom);
	});
});
