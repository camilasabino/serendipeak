import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Mountain, MountainImage } from '../api/contract';
import { contractFixture } from '../api/test-support/contractFixtures';
import { ImagePreloaderProvider } from '../media/ImagePreloaderContext';
import { ImagePreloader } from '../media/preload';
import { pageRendition } from '../media/renditions';
import { MountainPhoto } from './MountainPhoto';
import { anchorsOf, textsOf } from './test-support/markup';

const image = (contractFixture('mountain-complete.json') as Mountain).primaryImage as MountainImage;

function without(keys: (keyof MountainImage)[]): MountainImage {
	return Object.fromEntries(
		Object.entries(image).filter(([key]) => !keys.includes(key as keyof MountainImage))
	) as unknown as MountainImage;
}

function render(
	photo: MountainImage,
	preloader = new ImagePreloader({ create: () => undefined })
): string {
	return renderToStaticMarkup(
		<ImagePreloaderProvider value={preloader}>
			<MountainPhoto image={photo} mountainName="Aconcagua" />
		</ImagePreloaderProvider>
	);
}

const escaped = (value: string | undefined) => (value ?? '').replaceAll('&', '&amp;');

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

	it('requests exactly the contract thumbnail, without synthesized candidates', () => {
		const html = render(image);

		expect(html).toContain(`src="${escaped(image.thumbnailUrl!)}"`);
		expect(html).not.toMatch(/srcSet|sizes=/);
		expect(html.match(/\bsrc="[^"]*"/g)).toHaveLength(1);
	});

	it('requests the original when the contract has no thumbnail', () => {
		const html = render({ ...image, thumbnailUrl: undefined });

		expect(html).toContain(`src="${escaped(image.url)}"`);
		expect(html).not.toMatch(/srcSet|sizes=/);
	});

	it('keeps a single source for a thumbnail that is not a known rendition url', () => {
		const html = render({ ...image, thumbnailUrl: 'https://example.test/photo.jpg' });

		expect(html).toContain('src="https://example.test/photo.jpg"');
		expect(html).not.toMatch(/srcSet|sizes=/);
	});

	it('starts hidden and not openable until the image is ready', () => {
		const html = render(image);

		expect(html).toContain('data-state="pending"');
		expect(html).toMatch(/<button[^>]*disabled=""[^>]*>/);
		expect(textsOf(html, 'button')).toEqual(['View photo fullscreen']);
	});

	it('draws the frame from the size the shared preloader already measured', () => {
		const preloader = new ImagePreloader({ create: () => undefined });
		preloader.remember(pageRendition(image), { width: 1000, height: 1000 });

		expect(render(image, preloader)).toMatch(/aspect-ratio:1[;"]/);
	});

	it('renders no viewer until it is opened', () => {
		expect(render(image)).not.toContain('<dialog');
	});

	it('keeps the photograph out of the tab order and of any busy announcement', () => {
		expect(render(image)).not.toMatch(/aria-busy|role="status"|role="alert"|tabindex/);
	});
});
