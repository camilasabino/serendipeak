import { describe, expect, it, vi } from 'vitest';
import type { ScaleReading } from './scaleBar';
import { ScaleTracker } from './scaleTracker';

const KM: ScaleReading = { widthPx: 100, meters: 1000, label: '1 km' };

function harness(initial: ScaleReading | undefined) {
	let reading: ScaleReading | undefined = initial;
	let clock = 0;
	let trigger = () => {};
	const queue: { work: () => void; delayMs: number; cancelled: boolean }[] = [];
	const stopListening = vi.fn();
	const published: (ScaleReading | undefined)[] = [];
	const tracker = new ScaleTracker({
		sample: () => reading,
		publish: (next) => published.push(next),
		listen: (onChange) => {
			trigger = onChange;
			return stopListening;
		},
		now: () => clock,
		schedule: (work, delayMs) => {
			const entry = { work, delayMs, cancelled: false };
			queue.push(entry);
			return () => {
				entry.cancelled = true;
			};
		}
	});
	return {
		tracker,
		published,
		queue,
		stopListening,
		trigger: () => trigger(),
		set(next: ScaleReading | undefined) {
			reading = next;
		},
		advance(ms: number) {
			clock += ms;
		},
		runNext() {
			const entry = queue.shift();
			if (entry && !entry.cancelled) {
				entry.work();
			}
		}
	};
}

describe('scale tracker', () => {
	it('measures once on start', () => {
		const scene = harness(KM);

		expect(scene.queue).toHaveLength(1);
		scene.runNext();

		expect(scene.published).toEqual([KM]);
	});

	it('coalesces bursts of camera changes into one measurement', () => {
		const scene = harness(KM);
		scene.runNext();
		scene.advance(500);

		scene.trigger();
		scene.trigger();
		scene.trigger();

		expect(scene.queue).toHaveLength(1);
	});

	it('bounds the update rate', () => {
		const scene = harness(KM);
		scene.runNext();
		scene.advance(30);

		scene.trigger();

		expect(scene.queue[0]!.delayMs).toBe(90);
	});

	it('does not republish an equivalent reading', () => {
		const scene = harness(KM);
		scene.runNext();
		scene.advance(500);
		scene.set({ ...KM, widthPx: 100.4 });

		scene.trigger();
		scene.runNext();

		expect(scene.published).toEqual([KM]);
	});

	it('republishes when the value or the width changes', () => {
		const scene = harness(KM);
		scene.runNext();
		scene.advance(500);
		const next: ScaleReading = { widthPx: 90, meters: 500, label: '500 m' };
		scene.set(next);

		scene.trigger();
		scene.runNext();

		expect(scene.published).toEqual([KM, next]);
	});

	it('hides the scale as soon as a measurement is invalid', () => {
		const scene = harness(KM);
		scene.runNext();
		scene.advance(500);
		scene.set(undefined);

		scene.trigger();
		scene.runNext();

		expect(scene.published).toEqual([KM, undefined]);
	});

	it('recalculates on an explicit refresh such as a resize', () => {
		const scene = harness(KM);
		scene.runNext();
		scene.advance(500);
		scene.set({ widthPx: 64, meters: 500, label: '500 m' });

		scene.tracker.refresh();
		scene.runNext();

		expect(scene.published).toHaveLength(2);
	});

	it('stops listening, cancels pending work and hides the scale on release', () => {
		const scene = harness(KM);
		scene.runNext();
		scene.advance(500);
		scene.trigger();

		scene.tracker.release();
		scene.runNext();

		expect(scene.stopListening).toHaveBeenCalledTimes(1);
		expect(scene.published).toEqual([KM, undefined]);

		scene.trigger();
		expect(scene.queue).toHaveLength(0);
	});

	it('does not announce a hidden scale that was never shown', () => {
		const scene = harness(undefined);
		scene.runNext();
		scene.tracker.release();

		expect(scene.published).toEqual([]);
	});
});
