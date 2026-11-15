import type { ReactElement } from 'react';
import type { Mountain } from '../api/contract';
import { mountainHref } from '../explore/navigate';
import { formatElevation } from '../formatElevation';
import { socialPhotographUrl } from '../media/socialPhotograph';
import { photoAlt } from '../media/primaryPhoto';
import type { MountainPageModel } from './applyPageLoad';
import { formatCountries, formatRegion } from './format';
import type { MountainShare } from './shareLink';
import { SITE_DESCRIPTION, SITE_NAME } from './pageCopy';

export const HOME_PATH = '/';
export const BRAND_IMAGE_PATH = '/brand/serendipeak-mark.png';
const BRAND_IMAGE_SIZE = 1254;
const BRAND_IMAGE_ALT = 'The SerendiPeak mark: a mountain peak above a wave line';
const MAX_DESCRIPTION_LENGTH = 200;

export interface SocialImage {
	url: string;
	alt: string;
	width?: number;
	height?: number;
	/** A wide photograph, as opposed to the square brand mark. */
	wide: boolean;
}

/** What a page tells search engines and link previews about itself. */
export interface SocialDescriptor {
	title: string;
	description: string;
	canonicalUrl: string | null;
	image: SocialImage | null;
}

export function mountainDescription(mountain: Mountain): string {
	const summary = mountain.summary?.replace(/\s+/g, ' ').trim();
	if (summary) {
		return truncate(summary);
	}

	const place = mountain.region
		? formatRegion(mountain.region)
		: mountain.countries.length > 0
			? formatCountries(mountain.countries.map((country) => country.name))
			: mountain.continent.name;

	return `${mountain.name} rises ${formatElevation(mountain.elevationMeters)} in ${place}. Explore it in 3D on ${SITE_NAME}.`;
}

function truncate(text: string): string {
	if (text.length <= MAX_DESCRIPTION_LENGTH) {
		return text;
	}

	const cut = text.slice(0, MAX_DESCRIPTION_LENGTH - 1);
	const boundary = cut.lastIndexOf(' ');

	return `${(boundary > 0 ? cut.slice(0, boundary) : cut).replace(/[\s.,;:]+$/, '')}…`;
}

export function mountainShare(slug: string, origin: string | null): MountainShare {
	return { path: mountainHref(slug), canonicalUrl: mountainCanonicalUrl(slug, origin) };
}

export function mountainCanonicalUrl(slug: string, origin: string | null): string | null {
	return absolute(origin, mountainHref(slug));
}

function absolute(origin: string | null, path: string): string | null {
	return origin === null ? null : `${origin}${path}`;
}

function brandImage(origin: string | null): SocialImage | null {
	const url = absolute(origin, BRAND_IMAGE_PATH);

	return url === null
		? null
		: { url, alt: BRAND_IMAGE_ALT, width: BRAND_IMAGE_SIZE, height: BRAND_IMAGE_SIZE, wide: false };
}

// The canonical is the permanent address from the API's current slug, so a historical alias and
// any query string never leak into it.
function mountainDescriptor(mountain: Mountain, origin: string | null): SocialDescriptor {
	const photograph = socialPhotographUrl(mountain.primaryImage);

	return {
		title: `${mountain.name} (${formatElevation(mountain.elevationMeters)})`,
		description: mountainDescription(mountain),
		canonicalUrl: mountainCanonicalUrl(mountain.slug, origin),
		image: photograph
			? { url: photograph, alt: photoAlt(mountain.name), wide: true }
			: brandImage(origin)
	};
}

// The daily page names the site, not the day's mountain: a link preview is cached by social
// platforms for far longer than the mountain stays featured.
function homeDescriptor(origin: string | null): SocialDescriptor {
	return {
		title: SITE_NAME,
		description: SITE_DESCRIPTION,
		canonicalUrl: absolute(origin, HOME_PATH),
		image: brandImage(origin)
	};
}

/** Previews and failed loads publish nothing: they are private or not pages at all. */
export function socialDescriptorFor(
	model: MountainPageModel,
	origin: string | null
): SocialDescriptor | null {
	switch (model.kind) {
		case 'mountain':
			return model.preview ? null : mountainDescriptor(model.mountain, origin);
		case 'daily':
			return homeDescriptor(origin);
		case 'error':
			return null;
	}
}

// Every tag has a key so that navigating between pages replaces the previous page's tags.
export function socialTags(descriptor: SocialDescriptor): ReactElement[] {
	const { title, description, canonicalUrl, image } = descriptor;
	const tags: ReactElement[] = [
		<meta key="description" name="description" content={description} />,
		<meta key="og:type" property="og:type" content="website" />,
		<meta key="og:site_name" property="og:site_name" content={SITE_NAME} />,
		<meta key="og:title" property="og:title" content={title} />,
		<meta key="og:description" property="og:description" content={description} />,
		<meta
			key="twitter:card"
			name="twitter:card"
			content={image?.wide ? 'summary_large_image' : 'summary'}
		/>,
		<meta key="twitter:title" name="twitter:title" content={title} />,
		<meta key="twitter:description" name="twitter:description" content={description} />
	];

	if (canonicalUrl) {
		tags.push(
			<link key="canonical" rel="canonical" href={canonicalUrl} />,
			<meta key="og:url" property="og:url" content={canonicalUrl} />
		);
	}

	if (image) {
		tags.push(
			<meta key="og:image" property="og:image" content={image.url} />,
			<meta key="og:image:alt" property="og:image:alt" content={image.alt} />,
			<meta key="twitter:image" name="twitter:image" content={image.url} />,
			<meta key="twitter:image:alt" name="twitter:image:alt" content={image.alt} />
		);
		if (image.width && image.height) {
			tags.push(
				<meta key="og:image:width" property="og:image:width" content={String(image.width)} />,
				<meta key="og:image:height" property="og:image:height" content={String(image.height)} />
			);
		}
	}

	return tags;
}
