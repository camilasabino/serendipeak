import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { indexEntry } from '../api/test-support/indexEntries';
import { greatCircleDistanceMeters } from '../stage/globe/geodesic';
import { toAtlasMarkers } from './toAtlasMarkers';

interface CatalogEntry {
	slug: string;
	name: string;
	coordinates: { latitude: number; longitude: number };
	elevationMeters: number;
}

const CATALOG = (
	JSON.parse(
		readFileSync(new URL('../../../../contracts/v1/catalog.json', import.meta.url), 'utf8')
	) as { mountains: CatalogEntry[] }
).mountains.map((mountain) => indexEntry(mountain.slug, mountain.name, mountain));

describe('toAtlasMarkers', () => {
	it('places a marker at the coordinates and elevation of its index entry', () => {
		const entry = indexEntry('everest', 'Mount Everest', {
			coordinates: { latitude: 27.9881, longitude: 86.925 },
			elevationMeters: 8849
		});

		expect(toAtlasMarkers([entry])).toEqual([
			{
				slug: 'everest',
				name: 'Mount Everest',
				latitude: 27.9881,
				longitude: 86.925,
				elevationMeters: 8849
			}
		]);
	});

	it('draws nothing for an empty index', () => {
		expect(toAtlasMarkers([])).toEqual([]);
	});
});

describe('toAtlasMarkers on the vendored catalog', () => {
	const markers = toAtlasMarkers(CATALOG);

	it('gives every mountain exactly one marker, keyed by a unique slug', () => {
		expect(markers).toHaveLength(CATALOG.length);
		expect(new Set(markers.map((marker) => marker.slug)).size).toBe(CATALOG.length);
	});

	it('gives every marker a finite position on the globe and a name to label it with', () => {
		for (const marker of markers) {
			expect(Math.abs(marker.latitude)).toBeLessThanOrEqual(90);
			expect(Math.abs(marker.longitude)).toBeLessThanOrEqual(180);
			expect(Number.isFinite(marker.elevationMeters)).toBe(true);
			expect(marker.name.trim()).not.toBe('');
		}
	});

	it('keeps very close summits as separate markers', () => {
		const bySlug = new Map(markers.map((marker) => [marker.slug, marker]));
		const closest = [
			['mount-everest', 'ama-dablam'],
			['mont-blanc', 'matterhorn'],
			['vinson-massif', 'mount-tyree']
		] as const;

		for (const [a, b] of closest) {
			const distance = greatCircleDistanceMeters(bySlug.get(a)!, bySlug.get(b)!);
			expect(distance).toBeGreaterThan(0);
			expect(distance).toBeLessThan(100_000);
		}
	});
});
