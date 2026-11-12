// SerendiPeak's mountain documents differ from the v1 documents the repository vendors, which
// are never edited. The photograph has one author where v1 had an attribution and a creator, and
// carries no Commons file title. The mountain serves neither the prominence nor the Wikipedia
// link: the Wikidata item is the reference that stays. Countries are objects with a code and a
// name where v1 listed names, every mountain has a continent, which v1 did not have, and the
// range name is a region with its ancestors, always present and null without one.
// Anything that serves or reads a v1 document as SerendiPeak's own applies this first.
//
// The geography of the stub is synthetic: the countries of the vendored documents are mapped
// through the small table below, and the continent is the one of the first country. A document
// without any country gets the synthetic continent for its coordinates (45 N, 10 E). None of
// this is editorial data; the API serves the assignments of the catalog.
const COUNTRIES_OF_V1_NAMES = {
	Argentina: { code: 'AR', name: 'Argentina', continent: 'SA' },
	Greece: { code: 'GR', name: 'Greece', continent: 'EU' }
};
const CONTINENT_NAMES = { EU: 'Europe', SA: 'South America' };
const CONTINENT_WITHOUT_COUNTRIES = 'EU';

function syntheticGeography(mountain) {
	if (!Array.isArray(mountain.countries) || mountain.continent !== undefined) {
		return;
	}
	const countries = mountain.countries.map((name) => {
		const country = COUNTRIES_OF_V1_NAMES[name];
		if (country === undefined) {
			throw new Error(`the stub has no synthetic country for ${name}`);
		}
		return country;
	});
	const continent = countries[0]?.continent ?? CONTINENT_WITHOUT_COUNTRIES;
	mountain.continent = { code: continent, name: CONTINENT_NAMES[continent] };
	mountain.countries = countries.map(({ code, name }) => ({ code, name }));
}

// The region of the stub is synthetic as well: a root region named by the v1 range, with the slug
// derived from its name, or none.
function syntheticRegion(mountain) {
	if (mountain.region !== undefined) {
		return;
	}
	const name = mountain.rangeName;
	delete mountain.rangeName;
	if (name === undefined) {
		mountain.region = null;
		return;
	}
	const slug = name
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	mountain.region = { slug, name, ancestors: [] };
}

export function serendipeakDocument(document) {
	const copy = structuredClone(document);
	const mountain = copy.mountain ?? copy;
	delete mountain.prominenceMeters;
	syntheticGeography(mountain);
	syntheticRegion(mountain);
	if (mountain.sources !== undefined) {
		delete mountain.sources.wikipedia;
		if (Object.keys(mountain.sources).length === 0) {
			delete mountain.sources;
		}
	}
	const image = mountain.primaryImage;
	if (image !== undefined) {
		image.author = image.attribution;
		delete image.attribution;
		delete image.creator;
		delete image.sourceIdentifier;
	}

	return copy;
}

const INDEX_MEMBERS = [
	'slug',
	'name',
	'coordinates',
	'elevationMeters',
	'continent',
	'countries',
	'region'
];

// An entry of the mountain index is the part of a SerendiPeak mountain document that names and
// locates it, with the same values.
export function mountainIndexEntry(mountain) {
	return Object.fromEntries(INDEX_MEMBERS.map((member) => [member, mountain[member]]));
}
