// SerendiPeak's mountain documents differ from the v1 documents the repository vendors, which
// are never edited. The photograph has one author where v1 had an attribution and a creator, and
// carries no Commons file title. The mountain serves neither the prominence nor the Wikipedia
// link: the Wikidata item is the reference that stays. Anything that serves or reads a v1
// document as SerendiPeak's own applies this first.
export function serendipeakDocument(document) {
	const copy = structuredClone(document);
	const mountain = copy.mountain ?? copy;
	delete mountain.prominenceMeters;
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
