import { describe, expect, it } from 'vitest';
import { contractFixture, MOUNTAIN_FIXTURES } from './test-support/contractFixtures';
import { hasErrorCode, isCalendarDate, isDailyMountain, isMountain, isValidSlug } from './schema';

type Json = Record<string, unknown>;

const complete = contractFixture('mountain-complete.json') as Json;
const minimal = contractFixture('mountain-minimal.json') as Json;
const camera = complete.camera as Json;
const image = complete.primaryImage as Json;

function without(record: Json, key: string): Json {
	return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

describe('isMountain', () => {
	it.each(MOUNTAIN_FIXTURES)('accepts %s', (name) => {
		expect(isMountain(contractFixture(name))).toBe(true);
	});

	it('accepts every optional field being absent', () => {
		expect(isMountain(minimal)).toBe(true);
	});

	it.each(['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA'])('accepts the continent code %s', (code) => {
		expect(isMountain({ ...complete, continent: { code, name: 'Somewhere' } })).toBe(true);
	});

	it('accepts a mountain without a region, served as null', () => {
		expect(isMountain({ ...complete, region: null })).toBe(true);
	});

	it.each([0, 1, 3, 6])('accepts a region with %i ancestors', (depth) => {
		const ancestors = Array.from({ length: depth }, (_, index) => ({
			slug: `level-${index}`,
			name: `Level ${index}`
		}));

		expect(isMountain({ ...complete, region: { slug: 'leaf', name: 'Leaf', ancestors } })).toBe(
			true
		);
	});

	it('accepts a mountain without countries', () => {
		expect(isMountain({ ...complete, countries: [] })).toBe(true);
	});

	it('accepts several countries', () => {
		const countries = [
			{ code: 'CN', name: 'China' },
			{ code: 'NP', name: 'Nepal' }
		];

		expect(isMountain({ ...complete, countries })).toBe(true);
	});

	it.each([
		'id',
		'slug',
		'name',
		'coordinates',
		'elevationMeters',
		'continent',
		'countries',
		'region'
	])('rejects a mountain without %s', (key) => {
		expect(isMountain(without(complete, key))).toBe(false);
	});

	it.each(['summary', 'camera', 'primaryImage', 'sources'])(
		'rejects %s when present as null',
		(key) => {
			expect(isMountain({ ...complete, [key]: null })).toBe(false);
		}
	);

	it.each([
		['blank id', { id: '' }],
		['blank slug', { slug: '' }],
		['blank name', { name: '' }],
		['blank summary', { summary: '' }],
		['fractional elevation', { elevationMeters: 6961.5 }],
		['zero elevation', { elevationMeters: 0 }],
		['string elevation', { elevationMeters: '6961' }],
		['non-array countries', { countries: 'Argentina' }],
		['countries as names', { countries: ['Argentina'] }],
		['non-object country', { countries: [{ code: 'AR', name: 'Argentina' }, 1] }],
		['country without a name', { countries: [{ code: 'AR' }] }],
		['country with a blank name', { countries: [{ code: 'AR', name: '' }] }],
		['country without a code', { countries: [{ name: 'Argentina' }] }],
		['lowercase country code', { countries: [{ code: 'ar', name: 'Argentina' }] }],
		['three-letter country code', { countries: [{ code: 'ARG', name: 'Argentina' }] }],
		[
			'duplicate country',
			{
				countries: [
					{ code: 'AR', name: 'Argentina' },
					{ code: 'AR', name: 'Argentina' }
				]
			}
		],
		['string continent', { continent: 'South America' }],
		['null continent', { continent: null }],
		['continent without a name', { continent: { code: 'SA' } }],
		['continent with a blank name', { continent: { code: 'SA', name: '' } }],
		['unknown continent code', { continent: { code: 'ZZ', name: 'Nowhere' } }],
		['lowercase continent code', { continent: { code: 'sa', name: 'South America' } }],
		['undefined region', { region: undefined }],
		['string region', { region: 'Andes' }],
		['region without a slug', { region: { name: 'Alpha Chain', ancestors: [] } }],
		['region with an invalid slug', { region: { slug: 'Alpha', name: 'A', ancestors: [] } }],
		['region with the reserved slug', { region: { slug: 'today', name: 'A', ancestors: [] } }],
		['region with a blank name', { region: { slug: 'alpha-chain', name: '', ancestors: [] } }],
		['region without ancestors', { region: { slug: 'alpha-chain', name: 'Alpha Chain' } }],
		[
			'region with null ancestors',
			{ region: { slug: 'alpha-chain', name: 'Alpha Chain', ancestors: null } }
		],
		[
			'ancestor without a name',
			{ region: { slug: 'beta-range', name: 'B', ancestors: [{ slug: 'alpha-chain' }] } }
		],
		[
			'ancestor with an invalid slug',
			{ region: { slug: 'beta-range', name: 'B', ancestors: [{ slug: 'A B', name: 'A' }] } }
		],
		['latitude out of range', { coordinates: { latitude: 91, longitude: 0 } }],
		['longitude out of range', { coordinates: { latitude: 0, longitude: -181 } }],
		['missing longitude', { coordinates: { latitude: 0 } }],
		['non-finite latitude', { coordinates: { latitude: Number.NaN, longitude: 0 } }]
	])('rejects %s', (_label, override) => {
		expect(isMountain({ ...complete, ...override })).toBe(false);
	});

	it.each([
		['missing pitch', without(camera, 'pitchDegrees')],
		['heading at 360', { ...camera, headingDegrees: 360 }],
		['negative heading', { ...camera, headingDegrees: -0.1 }],
		['pitch above 15', { ...camera, pitchDegrees: 15.01 }],
		['pitch below -60', { ...camera, pitchDegrees: -60.01 }],
		['range below 2000', { ...camera, rangeMeters: 1999 }],
		['range above 80000', { ...camera, rangeMeters: 80_001 }],
		['partial framing', { ...camera, framing: { x: 0.2 } }],
		['framing out of range', { ...camera, framing: { x: 1.2, y: 0 } }],
		['null framing', { ...camera, framing: null }]
	])('rejects a camera with %s', (_label, invalidCamera) => {
		expect(isMountain({ ...complete, camera: invalidCamera })).toBe(false);
	});

	it.each([
		['the pitch upper bound', { pitchDegrees: 15 }],
		['the pitch lower bound', { pitchDegrees: -60 }],
		['the heading lower bound', { headingDegrees: 0 }],
		['the range bounds', { rangeMeters: 2000 }],
		['a framing at the limit', { framing: { x: -1, y: 1 } }]
	])('accepts a camera at %s', (_label, override) => {
		expect(isMountain({ ...complete, camera: { ...camera, ...override } })).toBe(true);
	});

	it('accepts a camera without framing', () => {
		expect(isMountain({ ...complete, camera: without(camera, 'framing') })).toBe(true);
	});

	it.each([
		['missing url', without(image, 'url')],
		['missing author', without(image, 'author')],
		['legacy attribution only', { ...without(image, 'author'), attribution: 'Someone' }],
		['javascript sourcePageUrl', { ...image, sourcePageUrl: 'javascript:alert(1)' }],
		['blank author', { ...image, author: '' }],
		['javascript url', { ...image, url: 'javascript:alert(1)' }],
		['relative url', { ...image, url: '/media/a.jpg' }],
		['null thumbnail', { ...image, thumbnailUrl: null }],
		['zero width', { ...image, width: 0 }],
		['fractional height', { ...image, height: 10.5 }],
		['non-http license url', { ...image, licenseUrl: 'ftp://license.test' }]
	])('rejects a primary image with %s', (_label, invalidImage) => {
		expect(isMountain({ ...complete, primaryImage: invalidImage })).toBe(false);
	});

	it('accepts a primary image reduced to its required fields', () => {
		const required = { url: image.url, author: image.author };

		expect(isMountain({ ...complete, primaryImage: required })).toBe(true);
	});

	it('accepts an uploaded photograph from another source', () => {
		const uploaded = {
			...image,
			author: 'Sébastien Goldberg',
			license: 'Unsplash License',
			licenseUrl: 'https://unsplash.com/license',
			sourcePageUrl: 'https://unsplash.com/photos/a-mountain'
		};

		expect(isMountain({ ...complete, primaryImage: uploaded })).toBe(true);
	});

	it.each([
		['javascript osm link', { osm: 'javascript:alert(1)' }],
		['null osm link', { osm: null }],
		['blank wikidata link', { wikidata: '' }]
	])('rejects sources with a %s', (_label, override) => {
		const sources = complete.sources as Json;

		expect(isMountain({ ...complete, sources: { ...sources, ...override } })).toBe(false);
	});

	it.each([null, undefined, 'aconcagua', 7, []])('rejects the non-object %j', (value) => {
		expect(isMountain(value)).toBe(false);
	});
});

describe('isValidSlug', () => {
	it.each(['a', 'k2', 'mont-blanc', 'puncak-jaya-2', '0'])('accepts %j', (value) => {
		expect(isValidSlug(value)).toBe(true);
	});

	it.each([
		'',
		'.',
		'..',
		'Mont-Blanc',
		'mont_blanc',
		'mont--blanc',
		'-mont',
		'mont-',
		'mont blanc',
		'mont/blanc',
		'mont%2Fblanc',
		'monté',
		'mont\n'
	])('rejects %j', (value) => {
		expect(isValidSlug(value)).toBe(false);
	});

	it.each(['today', 'random'])('rejects the reserved route word %j', (value) => {
		expect(isValidSlug(value)).toBe(false);
	});

	it.each([null, undefined, 1, {}])('rejects the non-string %j', (value) => {
		expect(isValidSlug(value)).toBe(false);
	});

	it('accepts every frozen catalog slug', () => {
		const { mountains } = contractFixture('catalog.json') as { mountains: { slug: string }[] };

		expect(mountains).toHaveLength(73);
		expect(mountains.every(({ slug }) => isValidSlug(slug))).toBe(true);
	});
});

describe('isCalendarDate', () => {
	it.each(['2026-10-12', '2024-02-29', '2026-12-31'])('accepts %s', (value) => {
		expect(isCalendarDate(value)).toBe(true);
	});

	it.each(['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '2026-10-1', '20261012', ''])(
		'rejects %j',
		(value) => {
			expect(isCalendarDate(value)).toBe(false);
		}
	);

	it.each([null, undefined, 20261012, {}])('rejects the non-string %j', (value) => {
		expect(isCalendarDate(value)).toBe(false);
	});
});

describe('isDailyMountain', () => {
	it('accepts the daily fixture', () => {
		expect(isDailyMountain(contractFixture('daily-mountain.json'))).toBe(true);
	});

	it('rejects a bare mountain', () => {
		expect(isDailyMountain(complete)).toBe(false);
	});
});

describe('hasErrorCode', () => {
	it('matches the code inside the contract envelope', () => {
		const envelope = contractFixture('error-mountain-not-found.json');

		expect(hasErrorCode(envelope, 'MOUNTAIN_NOT_FOUND')).toBe(true);
		expect(hasErrorCode(envelope, 'NO_ELIGIBLE_MOUNTAINS')).toBe(false);
	});

	it.each([null, undefined, 'MOUNTAIN_NOT_FOUND', { code: 'MOUNTAIN_NOT_FOUND' }, { error: null }])(
		'does not match %j',
		(body) => {
			expect(hasErrorCode(body, 'MOUNTAIN_NOT_FOUND')).toBe(false);
		}
	);
});
