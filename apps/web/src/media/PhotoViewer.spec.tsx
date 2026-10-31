import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Mountain, MountainImage } from '../api/contract';
import { contractFixture } from '../api/test-support/contractFixtures';
import { anchorsOf, textsOf } from '../mountain-page/test-support/markup';
import { PhotoViewer } from './PhotoViewer';
import { photoAlt } from './primaryPhoto';
import { pageRendition } from './renditions';

const image = (contractFixture('mountain-complete.json') as Mountain).primaryImage as MountainImage;
const initial = { src: 'https://x.test/960px-a.jpg', width: 960, height: 530 };

function render(photo: MountainImage = image, start: typeof initial | null = initial) {
	return renderToStaticMarkup(
		<PhotoViewer
			image={photo}
			mountainName="Aconcagua"
			initial={start ?? undefined}
			onClose={() => {}}
		/>
	);
}

function without(keys: (keyof MountainImage)[]): MountainImage {
	return Object.fromEntries(
		Object.entries(image).filter(([key]) => !keys.includes(key as keyof MountainImage))
	) as unknown as MountainImage;
}

describe('PhotoViewer', () => {
	it('is a labelled modal dialog subject to the photograph, not the stage', () => {
		const html = render();

		expect(html).toContain('<dialog ');
		expect(html).toContain('aria-modal="true"');
		expect(html).toContain(`aria-label="${photoAlt('Aconcagua')}"`);
		expect(html).not.toMatch(/canvas|cesium/i);
	});

	it('starts from the rendition the page already shows', () => {
		const html = render();

		expect(html).toContain(`src="${initial.src}"`);
		expect(html).toContain(`alt="${photoAlt('Aconcagua')}"`);
	});

	it('falls back to the page rendition when opened without a measured start', () => {
		expect(render(image, null)).toContain(
			`src="${pageRendition(image).src.replaceAll('&', '&amp;')}"`
		);
	});

	it('names its only control Close with a native button', () => {
		const html = render();

		expect(html.match(/<button/g)).toHaveLength(1);
		expect(html).toMatch(/<button type="button"[^>]*>/);
		expect(textsOf(html, 'button')).toEqual(['Close']);
	});

	it('keeps the credit, the linked license and the source page reachable', () => {
		const html = render();
		const anchors = anchorsOf(html);

		expect(textsOf(html, 'p').join(' ')).toContain(image.attribution);
		expect(anchors.find(({ text }) => text === image.license)?.href).toBe(image.licenseUrl);
		expect(anchors.find(({ text }) => text === 'Source: Wikimedia Commons')?.href).toBe(
			image.sourcePageUrl
		);
		for (const { attributes } of anchors) {
			expect(attributes).toContain('target="_blank"');
			expect(attributes).toContain('noopener');
		}
	});

	it('shows the license as plain text without a license url', () => {
		const html = render(without(['licenseUrl']));

		expect(textsOf(html, 'p').join(' ')).toContain(image.license);
		expect(anchorsOf(html).map(({ text }) => text)).toEqual(['Source: Wikimedia Commons']);
	});

	it('omits the license without one', () => {
		const html = render(without(['license', 'licenseUrl']));

		expect(textsOf(html, 'p')).toEqual([`${image.attribution}·Source: Wikimedia Commons`]);
	});

	it('sizes the image from the contract ratio so the frame cannot jump', () => {
		expect(render()).toContain(`aspect-ratio:${(image.width ?? 0) / (image.height ?? 1)}`);
	});

	it('does not size the image when neither the contract nor the page know the ratio', () => {
		expect(render(without(['width', 'height']), null)).not.toContain('aspect-ratio');
	});
});
