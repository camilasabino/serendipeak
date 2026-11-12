import { documentTitle, type ErrorContent } from '../mountain-page/pageCopy';

export const ATLAS_LINK_LABEL = 'Atlas';
export const ATLAS_TITLE = documentTitle('Atlas');
export const ATLAS_DESCRIPTION =
	'Every mountain on SerendiPeak on an interactive 3D globe: see where each one rises, how high it is, and open its page.';

export const ATLAS_HEADING = 'Atlas';
export const ATLAS_EMPTY = 'There are no mountains on the atlas yet.';

export function atlasLede(count: number): string {
	if (count === 0) {
		return ATLAS_EMPTY;
	}

	return count === 1
		? 'The one mountain on SerendiPeak, on the globe. Choose it to fly there and open its page.'
		: `All ${count.toLocaleString('en')} mountains on SerendiPeak, on the globe. Choose a continent, then a mountain to fly there and open its page.`;
}

export const ATLAS_LIST_HEADING = 'All mountains';

export function mountainCount(count: number): string {
	return count === 1 ? '1 mountain' : `${count.toLocaleString('en')} mountains`;
}

export const BACK_TO_ATLAS_LABEL = 'Back to atlas';

export const ATLAS_STAGE_LABEL = 'Preparing the atlas...';

export const ATLAS_LOAD_FAILED: ErrorContent = {
	title: "We couldn't load the atlas",
	message: "SerendiPeak couldn't load the atlas right now. Please try again.",
	retryable: true
};
