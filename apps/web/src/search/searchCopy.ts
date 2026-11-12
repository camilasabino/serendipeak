import type { IndexFailure } from './MountainIndexStore';

export const SEARCH_BUTTON_LABEL = 'Search';
export const SEARCH_BUTTON_LABEL_SUFFIX = ' mountains';
export const SEARCH_DIALOG_TITLE = 'Search mountains';
export const SEARCH_INPUT_LABEL = 'Mountain name';
export const SEARCH_INPUT_PLACEHOLDER = 'For example, Aconcagua';
export const SEARCH_RESULTS_LABEL = 'Matching mountains';
export const CLOSE_LABEL = 'Close';
export const RETRY_LABEL = 'Try again';
export const LOADING_MESSAGE = 'Loading mountains…';

const FAILURE_MESSAGES: Readonly<Record<IndexFailure, string>> = {
	unreachable: 'Mountain data is unavailable right now.',
	'api-error': 'The mountains could not be loaded.'
};

export function failureMessage(reason: IndexFailure): string {
	return FAILURE_MESSAGES[reason];
}

export function promptMessage(total: number): string {
	return total === 0
		? 'No mountains are available to search yet.'
		: `Type to search ${countLabel(total)}.`;
}

export function resultsMessage(count: number, query: string): string {
	return count === 0 ? `No mountain matches “${query.trim()}”.` : `${countLabel(count)} found.`;
}

function countLabel(count: number): string {
	return count === 1 ? '1 mountain' : `${count} mountains`;
}
