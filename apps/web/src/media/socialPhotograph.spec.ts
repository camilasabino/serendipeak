import { describe, expect, it } from 'vitest';
import type { MountainImage } from '../api/contract';
import { needsNoAttribution, socialPhotographUrl } from './socialPhotograph';

const base: MountainImage = {
	url: 'https://media.example/photographs/abc/original.jpg',
	thumbnailUrl: 'https://media.example/photographs/abc/page-r2.jpg',
	author: 'A. Photographer'
};

describe('socialPhotographUrl', () => {
	it('uses the page rendition of a public-domain photograph', () => {
		const image = {
			...base,
			license: 'CC0 1.0',
			licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/'
		};

		expect(socialPhotographUrl(image)).toBe('https://media.example/photographs/abc/page-r2.jpg');
	});

	it('recognizes a public-domain license by its name or its URL alone', () => {
		expect(needsNoAttribution({ ...base, license: 'Public domain' })).toBe(true);
		expect(
			needsNoAttribution({
				...base,
				licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/'
			})
		).toBe(true);
	});

	it.each([
		['an attribution license', { license: 'CC BY 4.0' }],
		[
			'a share-alike license',
			{ license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0' }
		],
		['a non-commercial license', { license: 'CC BY-NC 4.0' }],
		['no license', {}]
	])('refuses a photograph under %s', (_name, license) => {
		expect(socialPhotographUrl({ ...base, ...license })).toBeUndefined();
	});

	it('refuses a missing photograph and a rendition that is not an absolute http(s) URL', () => {
		expect(socialPhotographUrl(undefined)).toBeUndefined();
		expect(
			socialPhotographUrl({ ...base, license: 'CC0', thumbnailUrl: '/media/page.jpg' })
		).toBeUndefined();
		expect(
			socialPhotographUrl({ ...base, license: 'CC0', thumbnailUrl: 'data:image/png;base64,AA==' })
		).toBeUndefined();
	});
});
