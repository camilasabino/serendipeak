import { describe, expect, it, vi } from 'vitest';
import { SightingTracker } from './sightingTracker';
import type { SummitSightings } from './summitSighting';

function reading(x: number, y = 300): SummitSightings {
	return {
		viewport: { width: 800, height: 600 },
		presented: { kind: 'ahead', x: 400, y: 300 },
		nearby: [{ slug: 'el-plata', sighting: { kind: 'ahead', x, y } }]
	};
}

function view(initial: SummitSightings | undefined) {
	let current = initial;
	let onChange = () => {};
	const stop = vi.fn();
	const frames: (() => void)[] = [];

	return {
		listen: (listener: () => void) => {
			onChange = listener;
			return stop;
		},
		sample: vi.fn(() => current),
		schedule: (work: () => void) => {
			frames.push(work);
			return () => frames.splice(frames.indexOf(work), 1);
		},
		move(next: SummitSightings | undefined) {
			current = next;
			onChange();
		},
		nextFrame() {
			for (const work of frames.splice(0)) work();
		},
		stop,
		pendingFrames: () => frames.length
	};
}

function track(initial: SummitSightings | undefined) {
	const camera = view(initial);
	const published: (SummitSightings | undefined)[] = [];
	const tracker = new SightingTracker({
		sample: camera.sample,
		publish: (sightings) => published.push(sightings),
		listen: camera.listen,
		schedule: camera.schedule
	});

	return { camera, published, tracker };
}

describe('SightingTracker', () => {
	it('publishes the first reading on the next frame', () => {
		const { camera, published } = track(reading(900));

		expect(published).toEqual([]);
		camera.nextFrame();

		expect(published).toEqual([reading(900)]);
	});

	it('samples only when the view changes, and publishes a change only when it shows', () => {
		const { camera, published } = track(reading(900));
		camera.nextFrame();

		camera.move(reading(900.2));
		camera.nextFrame();
		expect(published).toHaveLength(1);

		camera.move(reading(910));
		camera.nextFrame();
		expect(published).toEqual([reading(900), reading(910)]);
		expect(camera.sample).toHaveBeenCalledTimes(3);
	});

	it('publishes once per frame, the latest reading of it', () => {
		const { camera, published } = track(reading(900));

		camera.move(reading(950));
		camera.move(reading(1000));
		expect(camera.pendingFrames()).toBe(1);
		camera.nextFrame();

		expect(published).toEqual([reading(1000)]);
	});

	it('hears a summit becoming hidden, or seen again, as a change though it has not moved', () => {
		const sighting = { kind: 'ahead', x: 300, y: 300 } as const;
		const concealed = (hidden: boolean): SummitSightings => ({
			...reading(300),
			nearby: [{ slug: 'el-plata', sighting, ...(hidden && { concealed: 'terrain' as const }) }]
		});
		const { camera, published } = track(concealed(false));
		camera.nextFrame();

		camera.move(concealed(true));
		camera.nextFrame();
		camera.move(concealed(false));
		camera.nextFrame();

		expect(published.map((entry) => entry?.nearby[0]?.concealed)).toEqual([
			undefined,
			'terrain',
			undefined
		]);
	});

	it('hears a hidden summit’s bearing turning as a change though the summit has not moved', () => {
		const sighting = { kind: 'ahead', x: 300, y: 300 } as const;
		const turned = (x: number): SummitSightings => ({
			...reading(300),
			nearby: [
				{
					slug: 'el-plata',
					sighting,
					concealed: 'horizon',
					bearing: { kind: 'ahead', x, y: 200 }
				}
			]
		});
		const { camera, published } = track(turned(300));
		camera.nextFrame();

		camera.move(turned(300.2));
		camera.nextFrame();
		camera.move(turned(340));
		camera.nextFrame();

		expect(published.map((entry) => entry?.nearby[0]?.bearing)).toEqual([
			{ kind: 'ahead', x: 300, y: 200 },
			{ kind: 'ahead', x: 340, y: 200 }
		]);
	});

	it('publishes at once, within the frame that took the reading, when told to schedule that way', () => {
		const published: (SummitSightings | undefined)[] = [];
		let onChange = () => {};
		let current = reading(900);

		new SightingTracker({
			sample: () => current,
			publish: (sightings) => published.push(sightings),
			listen: (listener) => {
				onChange = listener;
				return () => {};
			},
			schedule: (work) => {
				work();
				return () => {};
			}
		});
		current = reading(950);
		onChange();

		expect(published).toEqual([reading(900), reading(950)]);
	});

	it('hears a resized stage as a change', () => {
		const { camera, published } = track(reading(900));
		camera.nextFrame();

		camera.move({ ...reading(900), viewport: { width: 400, height: 600 } });
		camera.nextFrame();

		expect(published.at(-1)?.viewport).toEqual({ width: 400, height: 600 });
	});

	it('on release stops listening, drops the pending frame and clears what it published', () => {
		const { camera, published, tracker } = track(reading(900));
		camera.nextFrame();
		camera.move(reading(1000));

		tracker.release();
		tracker.release();
		camera.nextFrame();
		camera.move(reading(1100));
		camera.nextFrame();

		expect(published).toEqual([reading(900), undefined]);
		expect(camera.stop).toHaveBeenCalledTimes(1);
	});
});
