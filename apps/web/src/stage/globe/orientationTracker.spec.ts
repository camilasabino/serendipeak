import { describe, expect, it, vi } from 'vitest';
import { OrientationTracker, type ViewOrientation } from './orientationTracker';

function source(readings: Array<ViewOrientation | undefined>) {
	let onFrame = () => {};
	const listen = vi.fn((listener: () => void) => {
		onFrame = listener;
		return vi.fn(() => {
			onFrame = () => {};
		});
	});
	let index = 0;
	return {
		listen,
		sample: () => readings[Math.min(index, readings.length - 1)],
		advance() {
			index += 1;
			onFrame();
		},
		frame: () => onFrame()
	};
}

describe('orientation tracker', () => {
	it('publishes the first finite heading and ignores a tiny follow-up', () => {
		const camera = source([{ viewHeadingDegrees: 12 }, { viewHeadingDegrees: 12.05 }]);
		const published: Array<ViewOrientation | undefined> = [];
		const tracker = new OrientationTracker({
			sample: camera.sample,
			listen: camera.listen,
			publish: (orientation) => published.push(orientation),
			schedule: (work) => {
				work();
				return () => {};
			}
		});

		expect(published).toEqual([{ viewHeadingDegrees: 12 }]);

		camera.advance();

		expect(published).toEqual([{ viewHeadingDegrees: 12 }]);
		tracker.release();
	});

	it('publishes when the heading moves, including across 0°', () => {
		const camera = source([
			{ viewHeadingDegrees: 10 },
			{ viewHeadingDegrees: 18 },
			{ viewHeadingDegrees: 359.2 },
			{ viewHeadingDegrees: 0.4 }
		]);
		const published: Array<ViewOrientation | undefined> = [];
		new OrientationTracker({
			sample: () => {
				const current = camera.sample();
				return current;
			},
			listen: camera.listen,
			publish: (orientation) => published.push(orientation),
			schedule: (work) => {
				work();
				return () => {};
			}
		});

		camera.advance();
		camera.advance();
		camera.advance();

		expect(published.map((orientation) => orientation?.viewHeadingDegrees)).toEqual([
			10, 18, 359.2, 0.4
		]);
	});

	it('hides a non-finite heading and does not repeat the hidden state', () => {
		const camera = source([
			{ viewHeadingDegrees: Number.NaN },
			{ viewHeadingDegrees: 40 },
			undefined,
			undefined
		]);
		const published: Array<ViewOrientation | undefined> = [];
		new OrientationTracker({
			sample: camera.sample,
			listen: camera.listen,
			publish: (orientation) => published.push(orientation),
			schedule: (work) => {
				work();
				return () => {};
			}
		});

		camera.advance();
		camera.advance();
		camera.advance();

		expect(published).toEqual([undefined, { viewHeadingDegrees: 40 }, undefined]);
	});

	it('removes the frame listener and clears the heading on release', () => {
		const camera = source([{ viewHeadingDegrees: 90 }]);
		const published: Array<ViewOrientation | undefined> = [];
		const tracker = new OrientationTracker({
			sample: camera.sample,
			listen: camera.listen,
			publish: (orientation) => published.push(orientation),
			schedule: (work) => {
				work();
				return () => {};
			}
		});
		const remove = camera.listen.mock.results[0]?.value as () => void;

		tracker.release();
		camera.frame();

		expect(remove).toHaveBeenCalledOnce();
		expect(published.at(-1)).toBeUndefined();
		expect(published.filter((orientation) => orientation?.viewHeadingDegrees === 90)).toHaveLength(
			1
		);
	});

	it('does not keep a released listener when a new tracker is attached', () => {
		const first = source([{ viewHeadingDegrees: 20 }]);
		const second = source([{ viewHeadingDegrees: 200 }]);
		const published: number[] = [];
		const firstTracker = new OrientationTracker({
			sample: first.sample,
			listen: first.listen,
			publish: (orientation) => {
				if (orientation) {
					published.push(orientation.viewHeadingDegrees);
				}
			},
			schedule: (work) => {
				work();
				return () => {};
			}
		});

		firstTracker.release();
		new OrientationTracker({
			sample: second.sample,
			listen: second.listen,
			publish: (orientation) => {
				if (orientation) {
					published.push(orientation.viewHeadingDegrees);
				}
			},
			schedule: (work) => {
				work();
				return () => {};
			}
		});
		first.frame();
		second.frame();

		expect(published).toEqual([20, 200]);
	});

	it('coalesces frame samples to one publish', () => {
		const camera = source([{ viewHeadingDegrees: 1 }, { viewHeadingDegrees: 30 }]);
		const published: Array<ViewOrientation | undefined> = [];
		let queued: (() => void) | undefined;
		new OrientationTracker({
			sample: camera.sample,
			listen: camera.listen,
			publish: (orientation) => published.push(orientation),
			schedule: (work) => {
				queued = work;
				return () => {
					queued = undefined;
				};
			}
		});

		expect(published).toEqual([]);
		camera.advance();
		queued?.();

		expect(published).toEqual([{ viewHeadingDegrees: 30 }]);
	});
});
