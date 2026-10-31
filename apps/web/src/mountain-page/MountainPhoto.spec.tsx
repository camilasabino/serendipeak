import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Mountain, MountainImage } from '../api/contract';
import { contractFixture } from '../api/test-support/contractFixtures';
import { MountainPhoto } from './MountainPhoto';
import { anchorsOf, textsOf } from './test-support/markup';

const image = (contractFixture('mountain-complete.json') as Mountain).primaryImage as MountainImage;

function without(keys: (keyof MountainImage)[]): MountainImage {
	return Object.fromEntries(
		Object.entries(image).filter(([key]) => !keys.includes(key as keyof MountainImage))
	) as unknown as MountainImage;
}

function render(photo: MountainImage): string {
	return renderToStaticMarkup(<MountainPhoto image={photo} mountainName="Aconcagua" />);
}

describe('MountainPhoto', () => {
	it('renders the photograph with a name-based alt inside one figure', () => {
		const html = render(image);

		expect(html.match(/<figure/g)).toHaveLength(1);
		expect(html).toContain('alt="Photograph of Aconcagua"');
		expect(html).toContain(`src="${image.thumbnailUrl?.replaceAll('&', '&amp;')}"`);
	});

	it('falls back to the original url without a thumbnail', () => {
		expect(render(without(['thumbnailUrl']))).toContain(
			`src="${image.url.replaceAll('&', '&amp;')}"`
		);
	});

	it('reserves the natural aspect ratio from the contract dimensions', () => {
		expect(render(image)).toContain(`aspect-ratio:${(image.width ?? 0) / (image.height ?? 1)}`);
	});

	it('reserves a 3:2 frame when the dimensions are absent', () => {
		expect(render(without(['width', 'height']))).toContain('aspect-ratio:1.5');
	});

	it('shows the attribution unchanged, the linked license and the source link', () => {
		const html = render(image);
		const anchors = anchorsOf(html);

		expect(textsOf(html, 'summary')).toEqual(['About this photo']);
		expect(textsOf(html, 'p')[0]).toBe(image.attribution);
		expect(anchors.find(({ text }) => text === image.license)?.href).toBe(image.licenseUrl);
		expect(anchors.find(({ text }) => text === 'View original on Wikimedia Commons')?.href).toBe(
			image.sourcePageUrl
		);
	});

	it('shows the license as plain text without a license url', () => {
		const html = render(without(['licenseUrl']));

		expect(textsOf(html, 'p')).toContain(image.license);
		expect(anchorsOf(html).map(({ text }) => text)).toEqual(['View original on Wikimedia Commons']);
	});

	it('omits the license row without a license', () => {
		const html = render(without(['license', 'licenseUrl']));

		expect(textsOf(html, 'p')).toEqual([
			image.attribution,
			'Source: View original on Wikimedia Commons'
		]);
	});

	it('never displays the source identifier as copy', () => {
		expect(render(image).replace(/<[^>]*>/g, ' ')).not.toContain(image.sourceIdentifier);
	});

	it('carries no readiness or viewer machinery', () => {
		const html = render(image);

		expect(html).not.toContain('<button');
		expect(html).not.toMatch(/opacity|data-ready|aria-busy/);
	});
});
