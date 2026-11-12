import type { MountainIndexEntry } from '../../api/contract';

export function indexEntry(
	slug: string,
	name: string,
	overrides: Partial<MountainIndexEntry> = {}
): MountainIndexEntry {
	return {
		slug,
		name,
		coordinates: { latitude: 45, longitude: 7 },
		elevationMeters: 4000,
		continent: { code: 'EU', name: 'Europe' },
		countries: [{ code: 'CH', name: 'Switzerland' }],
		region: null,
		...overrides
	};
}
