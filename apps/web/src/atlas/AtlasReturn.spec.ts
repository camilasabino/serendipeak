import { describe, expect, it } from 'vitest';
import { AtlasReturn, isPlainClick, type AtlasReturnRouter } from './AtlasReturn';

type Handler = (url: string) => void;

/**
 * A browser history and the slice of the Next router around it: pushes and replaces change the
 * route the way `router.push` does, pops run the router's pop hook first, and every entry keeps
 * its key for life, as Next's history entries do.
 */
class FakeBrowser {
	readonly entries: { key: string; path: string }[] = [];
	index = -1;
	pathname = '';
	private nextKey = 1;
	private popHook: () => boolean = () => true;
	private readonly handlers: Record<string, Set<Handler>> = {
		routeChangeStart: new Set(),
		routeChangeComplete: new Set(),
		routeChangeError: new Set()
	};

	readonly router: AtlasReturnRouter = {
		pathname: '',
		events: {
			on: (event, handler) => this.handlers[event]!.add(handler),
			off: (event, handler) => this.handlers[event]!.delete(handler)
		},
		beforePopState: (callback) => {
			this.popHook = callback;
		}
	};

	constructor(initialPath: string, stamped = true) {
		this.entries.push({ key: stamped ? this.stamp() : '', path: initialPath });
		this.index = 0;
		this.sync();
	}

	get path(): string {
		return this.entries[this.index]!.path;
	}

	get paths(): string[] {
		return this.entries.map((entry) => entry.path);
	}

	get currentKey(): string | undefined {
		return this.entries[this.index]!.key || undefined;
	}

	push(path: string): void {
		this.emit('routeChangeStart', path);
		this.entries.splice(this.index + 1, Infinity, { key: this.stamp(), path });
		this.index += 1;
		this.sync();
		this.emit('routeChangeComplete', path);
	}

	replace(path: string): void {
		this.emit('routeChangeStart', path);
		this.entries[this.index] = { key: this.entries[this.index]!.key, path };
		this.sync();
		this.emit('routeChangeComplete', path);
	}

	back(): void {
		this.go(-1);
	}

	forward(): void {
		this.go(1);
	}

	go(delta: number): void {
		const target = this.entries[this.index + delta];
		if (!target) {
			return;
		}
		this.index += delta;
		if (this.popHook()) {
			this.emit('routeChangeStart', target.path);
			this.sync();
			this.emit('routeChangeComplete', target.path);
		}
	}

	/** A navigation begins and has not finished. */
	start(path: string): void {
		this.emit('routeChangeStart', path);
	}

	/** Next stamps and renders the new entry before it announces that the navigation is complete. */
	commitPush(path: string): void {
		this.entries.splice(this.index + 1, Infinity, { key: this.stamp(), path });
		this.index += 1;
		this.sync();
	}

	complete(path: string): void {
		this.emit('routeChangeComplete', path);
	}

	/** The route a pending navigation was heading for was superseded. */
	fail(path: string): void {
		this.emit('routeChangeError', path);
	}

	/** A reload: a new document with the same history, so nothing is remembered. */
	reloaded(): void {
		this.sync();
	}

	private stamp(): string {
		return `key-${this.nextKey++}`;
	}

	// Next updates its pathname before it announces completion, and keeps it during the start.
	private sync(): void {
		this.pathname = this.path;
		Object.defineProperty(this.router, 'pathname', { value: this.pathname, configurable: true });
	}

	private emit(event: string, path: string): void {
		for (const handler of [...this.handlers[event]!]) {
			handler(path);
		}
	}
}

const ATLAS = '/atlas';
const OLYMPUS = '/mountains/olympus';
const ACONCAGUA = '/mountains/aconcagua';

function setup(initialPath = '/', stamped = true) {
	const browser = new FakeBrowser(initialPath, stamped);
	const atlasReturn = new AtlasReturn(() => browser.currentKey);
	const unbind = atlasReturn.bind(browser.router);

	// What the Back to atlas link does on a plain click.
	const returnToAtlas = () => {
		if (atlasReturn.entryBelowIsAtlas) {
			browser.back();
		} else {
			browser.push(ATLAS);
		}
	};

	return { browser, atlasReturn, unbind, returnToAtlas };
}

describe('AtlasReturn history policy', () => {
	it('steps back to the atlas it came from, leaving no second atlas entry above', () => {
		const { browser, returnToAtlas } = setup('/');
		browser.push(ATLAS);
		browser.push(OLYMPUS);

		returnToAtlas();

		expect(browser.path).toBe(ATLAS);
		expect(browser.paths).toEqual(['/', ATLAS, OLYMPUS]);
		expect(browser.index).toBe(1);
	});

	it('leaves the page before the atlas one Back away, and the mountain one Forward away', () => {
		const { browser, returnToAtlas } = setup('/');
		browser.push(ATLAS);
		browser.push(OLYMPUS);
		returnToAtlas();

		browser.forward();
		expect(browser.path).toBe(OLYMPUS);

		browser.back();
		browser.back();
		expect(browser.path).toBe('/');
	});

	it('pushes the atlas from a mountain page opened directly, so Back returns to the mountain', () => {
		const { browser, returnToAtlas } = setup(OLYMPUS);

		returnToAtlas();

		expect(browser.paths).toEqual([OLYMPUS, ATLAS]);
		browser.back();
		expect(browser.path).toBe(OLYMPUS);
	});

	it('pushes the atlas from a mountain reached through another mountain', () => {
		const { browser, returnToAtlas } = setup('/');
		browser.push(ATLAS);
		browser.push(OLYMPUS);
		browser.push(ACONCAGUA);

		returnToAtlas();

		expect(browser.paths).toEqual(['/', ATLAS, OLYMPUS, ACONCAGUA, ATLAS]);
	});

	it('pushes the atlas from the daily page, which the atlas did not open', () => {
		const { browser, returnToAtlas } = setup('/');
		browser.push(OLYMPUS);

		returnToAtlas();

		expect(browser.paths).toEqual(['/', OLYMPUS, ATLAS]);
	});

	it('keeps the history bounded across repeated atlas and mountain trips', () => {
		const { browser, returnToAtlas } = setup('/');
		browser.push(ATLAS);

		for (let trip = 0; trip < 5; trip += 1) {
			browser.push(trip % 2 === 0 ? OLYMPUS : ACONCAGUA);
			returnToAtlas();
		}

		expect(browser.index).toBe(1);
		expect(browser.path).toBe(ATLAS);
		expect(browser.entries.length).toBeLessThanOrEqual(3);
	});

	it('still returns by Back after the reader went Back to the atlas and Forward again', () => {
		const { browser, returnToAtlas } = setup('/');
		browser.push(ATLAS);
		browser.push(OLYMPUS);
		browser.back();
		browser.forward();

		returnToAtlas();

		expect(browser.index).toBe(1);
		expect(browser.path).toBe(ATLAS);
	});

	it('records a fresh trip after Back to the atlas and a different mountain', () => {
		const { browser, returnToAtlas } = setup('/');
		browser.push(ATLAS);
		browser.push(OLYMPUS);
		browser.back();
		browser.push(ACONCAGUA);

		returnToAtlas();

		expect(browser.paths).toEqual(['/', ATLAS, ACONCAGUA]);
		expect(browser.index).toBe(1);
	});

	it('does not mistake the entry before the atlas for one opened from it', () => {
		const { browser, atlasReturn } = setup(OLYMPUS);
		browser.push(ATLAS);

		browser.back();

		expect(browser.path).toBe(OLYMPUS);
		expect(atlasReturn.entryBelowIsAtlas).toBe(false);
	});

	it('does not record a Forward onto an entry the atlas did not open', () => {
		const { browser, atlasReturn } = setup('/');
		browser.push(OLYMPUS);
		browser.push(ATLAS);
		browser.back();
		browser.back();

		browser.forward();
		browser.forward();

		expect(browser.path).toBe(ATLAS);
		browser.back();
		expect(atlasReturn.entryBelowIsAtlas).toBe(false);
	});

	it('does not record a replace from the atlas', () => {
		const { browser, atlasReturn } = setup('/');
		browser.push(ATLAS);

		browser.replace(OLYMPUS);

		expect(atlasReturn.entryBelowIsAtlas).toBe(false);
	});

	it('does not let a navigation that failed leak into a later Back', () => {
		const { browser, atlasReturn } = setup('/');
		browser.push(ATLAS);
		browser.start(OLYMPUS);
		browser.fail(OLYMPUS);

		browser.back();

		expect(browser.path).toBe('/');
		expect(atlasReturn.entryBelowIsAtlas).toBe(false);
		browser.forward();
		expect(atlasReturn.entryBelowIsAtlas).toBe(false);
	});

	it('answers no after a reload, when it remembers nothing, and pushes', () => {
		const { browser, returnToAtlas } = setup('/');
		browser.push(ATLAS);
		browser.push(OLYMPUS);
		const reloaded = new AtlasReturn(() => browser.currentKey);
		reloaded.bind(browser.router);
		browser.reloaded();

		expect(reloaded.entryBelowIsAtlas).toBe(false);
		returnToAtlas();
		expect(browser.index).toBe(1);
	});

	it('answers no when the history entry carries no key', () => {
		const { browser, atlasReturn } = setup('/', false);
		browser.push(ATLAS);
		browser.push(OLYMPUS);
		const keyless = new AtlasReturn(() => undefined);
		keyless.bind(browser.router);

		expect(atlasReturn.entryBelowIsAtlas).toBe(true);
		expect(keyless.entryBelowIsAtlas).toBe(false);
	});

	it('stops listening and releases the pop hook when unbound', () => {
		const { browser, atlasReturn, unbind } = setup('/');
		unbind();

		browser.push(ATLAS);
		browser.push(OLYMPUS);

		expect(atlasReturn.entryBelowIsAtlas).toBe(false);
		browser.back();
		expect(browser.path).toBe(ATLAS);
	});
});

describe('AtlasReturn origin of the page on screen', () => {
	it.each([
		['a mountain opened from the atlas', ['/', ATLAS], OLYMPUS, true],
		['a mountain opened from the daily page', ['/'], OLYMPUS, false],
		[
			'a mountain opened from search or Explore on another mountain',
			['/', ATLAS, OLYMPUS],
			ACONCAGUA,
			false
		],
		['a page opened directly', [], OLYMPUS, false]
	])('answers for %s', (_name, trail, target, expected) => {
		const { browser, atlasReturn } = setup(trail[0] ?? target);
		for (const path of trail.slice(1)) {
			browser.push(path);
		}
		if (trail.length > 0) {
			browser.push(target);
		}

		expect(atlasReturn.entryBelowIsAtlas).toBe(expected);
	});

	it('hides the origin again once Today, Search or Explore leads on from an atlas mountain', () => {
		const { browser, atlasReturn } = setup('/');
		browser.push(ATLAS);
		browser.push(OLYMPUS);
		expect(atlasReturn.entryBelowIsAtlas).toBe(true);

		browser.push(ACONCAGUA);
		expect(atlasReturn.entryBelowIsAtlas).toBe(false);

		browser.back();
		expect(atlasReturn.entryBelowIsAtlas).toBe(true);
		browser.forward();
		expect(atlasReturn.entryBelowIsAtlas).toBe(false);
	});

	it('keeps answering from the entry across Back and Forward through the atlas', () => {
		const { browser, atlasReturn } = setup('/');
		browser.push(ATLAS);
		browser.push(OLYMPUS);

		browser.back();
		browser.forward();

		expect(browser.path).toBe(OLYMPUS);
		expect(atlasReturn.entryBelowIsAtlas).toBe(true);
	});

	it('answers yes while the push from the atlas renders, before it is announced complete', () => {
		const { browser, atlasReturn } = setup('/');
		browser.push(ATLAS);

		browser.start(OLYMPUS);
		browser.commitPush(OLYMPUS);
		expect(atlasReturn.entryBelowIsAtlas).toBe(true);

		browser.complete(OLYMPUS);
		expect(atlasReturn.entryBelowIsAtlas).toBe(true);
	});

	it('does not answer yes while a push from another page renders', () => {
		const { browser, atlasReturn } = setup('/');

		browser.start(OLYMPUS);
		browser.commitPush(OLYMPUS);

		expect(atlasReturn.entryBelowIsAtlas).toBe(false);
		browser.complete(OLYMPUS);
		expect(atlasReturn.entryBelowIsAtlas).toBe(false);
	});

	it('does not answer yes while a Forward from the atlas renders', () => {
		const { browser, atlasReturn } = setup('/');
		browser.push(OLYMPUS);
		browser.push(ATLAS);
		browser.back();
		browser.forward();
		browser.back();
		browser.back();
		browser.forward();
		browser.forward();
		expect(browser.path).toBe(ATLAS);

		browser.back();

		expect(atlasReturn.entryBelowIsAtlas).toBe(false);
	});

	it('withdraws the answer when the push from the atlas fails', () => {
		const { browser, atlasReturn } = setup('/');
		browser.push(ATLAS);

		browser.start(OLYMPUS);
		expect(atlasReturn.entryBelowIsAtlas).toBe(true);
		browser.fail(OLYMPUS);

		expect(atlasReturn.entryBelowIsAtlas).toBe(false);
	});

	it('does not announce a push when the atlas entry carries no key', () => {
		const browser = new FakeBrowser('/');
		const atlasReturn = new AtlasReturn(() => undefined);
		atlasReturn.bind(browser.router);
		browser.push(ATLAS);

		browser.start(OLYMPUS);
		browser.commitPush(OLYMPUS);

		expect(atlasReturn.entryBelowIsAtlas).toBe(false);
	});

	it('notifies subscribers as the answer moves, and stops after they unsubscribe', () => {
		const { browser, atlasReturn } = setup('/');
		const answers: boolean[] = [];
		const unsubscribe = atlasReturn.subscribe(() => answers.push(atlasReturn.entryBelowIsAtlas));
		browser.push(ATLAS);

		browser.push(OLYMPUS);
		browser.push(ACONCAGUA);
		browser.back();

		expect(answers).toContain(true);
		expect(answers.at(-1)).toBe(true);
		expect(answers.filter((answer) => !answer).length).toBeGreaterThan(0);

		unsubscribe();
		const seen = answers.length;
		browser.forward();
		expect(answers).toHaveLength(seen);
	});
});

describe('AtlasReturn navigation apart from the atlas controls', () => {
	it('does not record a search made on the atlas, nor announce it while it renders', async () => {
		const { browser, atlasReturn } = setup('/');
		browser.push(ATLAS);

		await atlasReturn.navigateApart(async () => {
			browser.start(OLYMPUS);
			browser.commitPush(OLYMPUS);
			expect(atlasReturn.entryBelowIsAtlas).toBe(false);
			browser.complete(OLYMPUS);
		});

		expect(atlasReturn.entryBelowIsAtlas).toBe(false);
	});

	it('keeps Back and Forward of a searched mountain as they were', async () => {
		const { browser, atlasReturn } = setup('/');
		browser.push(ATLAS);
		await atlasReturn.navigateApart(async () => browser.push(OLYMPUS));

		browser.back();
		browser.forward();

		expect(browser.path).toBe(OLYMPUS);
		expect(atlasReturn.entryBelowIsAtlas).toBe(false);
	});

	it('still records the next push from an atlas control', async () => {
		const { browser, atlasReturn } = setup('/');
		browser.push(ATLAS);
		await atlasReturn.navigateApart(async () => browser.push(OLYMPUS));
		browser.back();

		browser.push(ACONCAGUA);

		expect(atlasReturn.entryBelowIsAtlas).toBe(true);
	});

	it('does not let a search that never started a route change taint a later atlas push', async () => {
		const { browser, atlasReturn } = setup('/');
		browser.push(ATLAS);

		await atlasReturn.navigateApart(async () => false);
		browser.push(OLYMPUS);

		expect(atlasReturn.entryBelowIsAtlas).toBe(true);
	});

	it('does not let a search that fails taint a later atlas push', async () => {
		const { browser, atlasReturn } = setup('/');
		browser.push(ATLAS);

		await expect(
			atlasReturn.navigateApart(async () => {
				throw new Error('offline');
			})
		).rejects.toThrow('offline');
		browser.push(OLYMPUS);

		expect(atlasReturn.entryBelowIsAtlas).toBe(true);
	});

	it('returns what the navigation resolves to', async () => {
		const { atlasReturn } = setup('/');

		await expect(atlasReturn.navigateApart(async () => true)).resolves.toBe(true);
	});
});

describe('isPlainClick', () => {
	const plain = {
		button: 0,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		defaultPrevented: false
	};

	it('accepts a primary click', () => {
		expect(isPlainClick(plain)).toBe(true);
	});

	it.each([
		{ button: 1 },
		{ button: 2 },
		{ metaKey: true },
		{ ctrlKey: true },
		{ shiftKey: true },
		{ altKey: true },
		{ defaultPrevented: true }
	])('leaves %j to the browser', (change) => {
		expect(isPlainClick({ ...plain, ...change })).toBe(false);
	});
});
