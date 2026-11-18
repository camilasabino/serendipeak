import { describe, expect, it } from 'vitest';
import { rowHighlight } from './rowHighlight';

function setup() {
	const calls: (string | undefined)[] = [];
	const handlers = rowHighlight((slug) => calls.push(slug), 'matterhorn');

	return { calls, handlers };
}

describe('rowHighlight', () => {
	it.each(['mouse', 'pen'])("emphasizes the row's marker while a %s rests on it", (pointerType) => {
		const { calls, handlers } = setup();

		handlers.onPointerEnter({ pointerType });
		handlers.onPointerLeave();

		expect(calls).toEqual(['matterhorn', undefined]);
	});

	it('leaves a finger alone: it has no hover, and its tap opens the page', () => {
		const { calls, handlers } = setup();

		handlers.onPointerEnter({ pointerType: 'touch' });

		expect(calls).toEqual([]);
	});

	it('gives the keyboard the same emphasis as the pointer', () => {
		const { calls, handlers } = setup();

		handlers.onFocus();
		handlers.onBlur();

		expect(calls).toEqual(['matterhorn', undefined]);
	});

	it('ends the emphasis when the link is followed', () => {
		const { calls, handlers } = setup();

		handlers.onFocus();
		handlers.onClick();

		expect(calls).toEqual(['matterhorn', undefined]);
	});

	it('follows the pointer from one row to the next, one emphasis at a time', () => {
		const calls: (string | undefined)[] = [];
		const first = rowHighlight((slug) => calls.push(slug), 'eiger');
		const second = rowHighlight((slug) => calls.push(slug), 'monch');

		first.onPointerEnter({ pointerType: 'mouse' });
		first.onPointerLeave();
		second.onPointerEnter({ pointerType: 'mouse' });

		expect(calls).toEqual(['eiger', undefined, 'monch']);
	});
});
