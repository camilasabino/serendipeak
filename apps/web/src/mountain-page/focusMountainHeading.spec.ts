import { describe, expect, it, vi } from 'vitest';
import { focusMountainHeading, MOUNTAIN_HEADING_ID } from './focusMountainHeading';

function fakeDocument(active: unknown, body: unknown) {
	const focus = vi.fn();
	const getElementById = vi.fn((id: string) => (id === MOUNTAIN_HEADING_ID ? { focus } : null));
	const doc = { activeElement: active, body, getElementById } as unknown as Document;

	return { doc, focus, getElementById };
}

describe('focusMountainHeading', () => {
	const body = { name: 'body' };
	const origin = { name: 'explore button' } as unknown as HTMLElement;

	it.each([
		['the control that started the run', origin],
		['the document body', body],
		['nothing', null]
	])('moves focus to the mountain heading when it is on %s', (_name, active) => {
		const { doc, focus } = fakeDocument(active, body);

		focusMountainHeading(origin, doc);

		expect(focus).toHaveBeenCalledTimes(1);
	});

	it('leaves focus where the user moved it', () => {
		const { doc, focus } = fakeDocument({ name: 'footer link' }, body);

		focusMountainHeading(origin, doc);

		expect(focus).not.toHaveBeenCalled();
	});

	it('does nothing when the page has no heading', () => {
		const doc = { activeElement: body, body, getElementById: () => null } as unknown as Document;

		expect(() => focusMountainHeading(null, doc)).not.toThrow();
	});
});
