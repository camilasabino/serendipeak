import { describe, expect, it } from 'vitest';
import type { SceneTarget } from './globe/camera';
import { TransitionCoordinator, type TransitionOutcome } from './TransitionCoordinator';

function target(slug: string): SceneTarget {
	return { slug, name: slug, latitude: 0, longitude: 0, elevationMeters: 1000 };
}

const ACONCAGUA = target('aconcagua');
const FITZ_ROY = target('fitz-roy');
const OLYMPUS = target('mount-olympus');

// Resolves with whatever an arrival holds right now, or 'pending' when it is still unsettled.
async function settledNow(
	arrival: Promise<TransitionOutcome>
): Promise<TransitionOutcome | 'pending'> {
	return Promise.race([arrival, Promise.resolve('pending' as const)]);
}

describe('TransitionCoordinator arrival', () => {
	it('stays pending while the scene travels and arrives with the scene', async () => {
		const coordinator = new TransitionCoordinator();
		const transition = coordinator.begin('fitz-roy');

		coordinator.presenting(FITZ_ROY);
		expect(await settledNow(transition.arrival)).toBe('pending');

		coordinator.presented(FITZ_ROY, 'arrived');
		expect(await transition.arrival).toBe('arrived');
	});

	it.each(['failed', 'interrupted'] as const)(
		'reports a %s camera outcome for the destination as it is',
		async (outcome) => {
			const coordinator = new TransitionCoordinator();
			const transition = coordinator.begin('fitz-roy');

			coordinator.presenting(FITZ_ROY);
			coordinator.presented(FITZ_ROY, outcome);

			expect(await transition.arrival).toBe(outcome);
		}
	);

	it('settles once and ignores every later report', async () => {
		const coordinator = new TransitionCoordinator();
		const transition = coordinator.begin('fitz-roy');

		coordinator.presented(FITZ_ROY, 'arrived');
		coordinator.presented(FITZ_ROY, 'failed');
		coordinator.ended();

		expect(await transition.arrival).toBe('arrived');
	});

	it('does not settle for a camera outcome of another mountain', async () => {
		const coordinator = new TransitionCoordinator();
		const transition = coordinator.begin('fitz-roy');

		coordinator.presented(ACONCAGUA, 'arrived');

		expect(await settledNow(transition.arrival)).toBe('pending');
	});

	it('is a plain value to await: its arrival never rejects', async () => {
		const coordinator = new TransitionCoordinator();
		const outcomes = [coordinator.begin('a'), coordinator.begin('b')].map((t) => t.arrival);

		coordinator.ended();

		await expect(Promise.all(outcomes)).resolves.toEqual(['superseded', 'interrupted']);
	});
});

describe('TransitionCoordinator supersession', () => {
	it('lets a newer transition win and settles the older one as superseded', async () => {
		const coordinator = new TransitionCoordinator();
		const first = coordinator.begin('fitz-roy');
		const second = coordinator.begin('mount-olympus');

		expect(await first.arrival).toBe('superseded');
		expect(await settledNow(second.arrival)).toBe('pending');
	});

	it('never lets the older transition complete the newer one', async () => {
		const coordinator = new TransitionCoordinator();
		const first = coordinator.begin('fitz-roy');
		const second = coordinator.begin('mount-olympus');

		coordinator.presented(FITZ_ROY, 'arrived');

		expect(await first.arrival).toBe('superseded');
		expect(await settledNow(second.arrival)).toBe('pending');

		coordinator.presented(OLYMPUS, 'arrived');
		expect(await second.arrival).toBe('arrived');
	});

	it('supersedes the pending transition when the scene presents another mountain', async () => {
		const coordinator = new TransitionCoordinator();
		const transition = coordinator.begin('fitz-roy');

		coordinator.presenting(ACONCAGUA);

		expect(await transition.arrival).toBe('superseded');
	});

	it('keeps the pending transition when the scene starts presenting its destination', async () => {
		const coordinator = new TransitionCoordinator();
		const transition = coordinator.begin('fitz-roy');

		coordinator.presenting(FITZ_ROY);

		expect(await settledNow(transition.arrival)).toBe('pending');
	});

	it('lets a repeated destination replace the previous transition to it', async () => {
		const coordinator = new TransitionCoordinator();
		const first = coordinator.begin('fitz-roy');
		const second = coordinator.begin('fitz-roy');

		coordinator.presented(FITZ_ROY, 'arrived');

		expect(await first.arrival).toBe('superseded');
		expect(await second.arrival).toBe('arrived');
	});
});

describe('TransitionCoordinator cancellation', () => {
	it('settles a cancelled transition as interrupted and frees the next one', async () => {
		const coordinator = new TransitionCoordinator();
		const first = coordinator.begin('fitz-roy');

		first.cancel();
		const second = coordinator.begin('mount-olympus');
		coordinator.presented(OLYMPUS, 'arrived');

		expect(await first.arrival).toBe('interrupted');
		expect(await second.arrival).toBe('arrived');
	});

	it('does not let a superseded transition cancel its successor', async () => {
		const coordinator = new TransitionCoordinator();
		const first = coordinator.begin('fitz-roy');
		const second = coordinator.begin('mount-olympus');

		first.cancel();

		expect(await settledNow(second.arrival)).toBe('pending');
	});

	it('does not change an arrival that already settled', async () => {
		const coordinator = new TransitionCoordinator();
		const transition = coordinator.begin('fitz-roy');
		coordinator.presented(FITZ_ROY, 'arrived');

		transition.cancel();

		expect(await transition.arrival).toBe('arrived');
	});

	it('settles the pending transition as interrupted when the scene session ends', async () => {
		const coordinator = new TransitionCoordinator();
		const transition = coordinator.begin('fitz-roy');

		coordinator.ended();

		expect(await transition.arrival).toBe('interrupted');
	});

	it('survives an end with nothing pending', () => {
		const coordinator = new TransitionCoordinator();

		expect(() => coordinator.ended()).not.toThrow();
	});
});

describe('TransitionCoordinator scene already at the destination', () => {
	it('arrives at once when the scene already settled on the destination', async () => {
		const coordinator = new TransitionCoordinator();
		coordinator.presenting(ACONCAGUA);
		coordinator.presented(ACONCAGUA, 'arrived');

		const transition = coordinator.begin('aconcagua');

		expect(await transition.arrival).toBe('arrived');
	});

	it('waits for the scene that is already travelling to the destination', async () => {
		const coordinator = new TransitionCoordinator();
		coordinator.presenting(FITZ_ROY);

		const transition = coordinator.begin('fitz-roy');
		expect(await settledNow(transition.arrival)).toBe('pending');

		coordinator.presented(FITZ_ROY, 'arrived');
		expect(await transition.arrival).toBe('arrived');
	});

	it('forgets the presentation once the scene session ended', async () => {
		const coordinator = new TransitionCoordinator();
		coordinator.presenting(ACONCAGUA);
		coordinator.presented(ACONCAGUA, 'arrived');
		coordinator.ended();

		const transition = coordinator.begin('aconcagua');

		expect(await settledNow(transition.arrival)).toBe('pending');
	});

	it('forgets a settled presentation when the scene moves on', async () => {
		const coordinator = new TransitionCoordinator();
		coordinator.presenting(ACONCAGUA);
		coordinator.presented(ACONCAGUA, 'arrived');
		coordinator.presenting(FITZ_ROY);

		const transition = coordinator.begin('aconcagua');

		expect(await settledNow(transition.arrival)).toBe('pending');
	});
});
