import { describe, expect, it } from 'vitest';
import { KILOMETERS_PER_MILE, describeDistance } from './formatDistance';

describe('describeDistance', () => {
	it('shows kilometers in the metric system, whole below a hundred', () => {
		expect(describeDistance(4.6, 'metric')).toEqual({
			value: '5',
			unit: 'km',
			spoken: 'about 5 kilometers'
		});
		expect(describeDistance(66.4, 'metric').value).toBe('66');
		expect(describeDistance(99.4, 'metric').value).toBe('99');
	});

	it('rounds to steps of five from a hundred, so it does not claim precision', () => {
		expect(describeDistance(101, 'metric').value).toBe('100');
		expect(describeDistance(122.4, 'metric').value).toBe('120');
		expect(describeDistance(123, 'metric').value).toBe('125');
	});

	it('groups thousands', () => {
		expect(describeDistance(1000, 'metric').value).toBe('1,000');
	});

	it('converts to miles in the imperial system', () => {
		const distance = describeDistance(100 * KILOMETERS_PER_MILE, 'imperial');

		expect(distance).toEqual({ value: '100', unit: 'mi', spoken: 'about 100 miles' });
		expect(describeDistance(1000, 'imperial').value).toBe('620');
		expect(describeDistance(50, 'imperial').value).toBe('31');
	});

	it('never says zero, and says one in the singular', () => {
		expect(describeDistance(0, 'metric')).toEqual({
			value: '1',
			unit: 'km',
			spoken: 'about 1 kilometer'
		});
		expect(describeDistance(0.3, 'imperial').spoken).toBe('about 1 mile');
	});
});
