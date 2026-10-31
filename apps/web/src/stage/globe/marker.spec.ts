import { describe, it, expect } from 'vitest';
import { planSummitMarker } from './marker';

describe('planSummitMarker', () => {
	it('keeps the canonical summit position and labels it with the name and the formatted elevation', () => {
		const marker = planSummitMarker({
			slug: 'aconcagua',
			name: 'Aconcagua',
			latitude: -32.65,
			longitude: -70.01,
			elevationMeters: 6961
		});

		expect(marker).toEqual({
			latitude: -32.65,
			longitude: -70.01,
			elevationMeters: 6961,
			label: 'Aconcagua\n6,961 m'
		});
	});

	it('uses the shared elevation format for every elevation', () => {
		const label = (elevationMeters: number) =>
			planSummitMarker({ slug: 'peak', name: 'Peak', latitude: 0, longitude: 0, elevationMeters })
				.label;

		expect(label(8849)).toBe('Peak\n8,849 m');
		expect(label(1345)).toBe('Peak\n1,345 m');
		expect(label(999)).toBe('Peak\n999 m');
	});
});
