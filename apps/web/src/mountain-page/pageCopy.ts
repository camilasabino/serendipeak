import { formatElevation } from '../formatElevation';
import type { MountainPageModel } from './applyPageLoad';
import type { FailureReason } from './pageModel';

export interface ErrorContent {
	title: string;
	message: string;
	retryable: boolean;
}

export const PAGE_NOT_FOUND: ErrorContent = {
	title: 'Page not found',
	message: "This page doesn't exist.",
	retryable: false
};

const MOUNTAIN_NOT_FOUND: ErrorContent = {
	title: 'Mountain not found',
	message: "We couldn't find that mountain.",
	retryable: false
};

const LOAD_FAILED: ErrorContent = {
	title: "We couldn't load the mountain",
	message: "SerendiPeak couldn't load the mountain right now. Please try again.",
	retryable: true
};

export function describeFailure(reason: FailureReason): ErrorContent {
	return reason === 'not-found' ? MOUNTAIN_NOT_FOUND : LOAD_FAILED;
}

export const SITE_NAME = 'SerendiPeak';
export const SITE_TAGLINE = 'A world of mountains to explore.';

export const SITE_DESCRIPTION =
	'Discover one mountain every day, with real photography, interactive 3D terrain and curated geography, then explore the collection in the atlas.';

export function documentTitle(title: string): string {
	return `${title} · ${SITE_NAME}`;
}

export function pageTitle(model: MountainPageModel): string {
	switch (model.kind) {
		case 'mountain':
			return documentTitle(
				model.preview
					? `Preview: ${model.mountain.name}`
					: `${model.mountain.name} (${formatElevation(model.mountain.elevationMeters)})`
			);
		case 'daily':
			return documentTitle(`Today's discovery: ${model.daily.mountain.name}`);
		case 'error':
			return documentTitle(describeFailure(model.reason).title);
	}
}

export const PREVIEW_NOTICE =
	'Preview of the saved draft. This mountain is not published, so visitors cannot see this page.';
export const DAILY_EYEBROW = 'Today';
export const DAILY_CUE = 'Tomorrow, another mountain.';
export const DAILY_CLOSING_NOTE = 'A new mountain is chosen every day at 00:00 UTC.';
export const TODAY_LINK_LABEL = 'Today';
export const TODAY_PATH = '/';

export function revealLabel(daily: boolean): string {
	return daily ? "Revealing today's mountain..." : 'Revealing the mountain...';
}
