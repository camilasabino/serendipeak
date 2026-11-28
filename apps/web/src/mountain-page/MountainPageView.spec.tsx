import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DailyMountain, Mountain } from '../api/contract';
import { contractFixture } from '../api/test-support/contractFixtures';
import { MountainPageView } from './MountainPageView';

vi.mock('next/head', () => ({
	default: ({ children }: { children: ReactNode }) => <>{children}</>
}));
vi.mock('./MountainView', () => ({
	MountainView: ({ nearby }: { nearby?: readonly unknown[] }) => (
		<p data-nearby={nearby === undefined ? 'none' : nearby.length} />
	)
}));
vi.mock('./ErrorView', () => ({ ErrorView: () => null }));

const mountain = contractFixture('mountain-complete.json') as Mountain;
const daily = contractFixture('daily-mountain.json') as DailyMountain;
const ORIGIN = 'https://serendipeak.example';

describe('MountainPageView head', () => {
	it('server-renders the canonical and the preview tags of a public mountain', () => {
		const html = renderToStaticMarkup(
			<MountainPageView model={{ kind: 'mountain', mountain }} siteOrigin={ORIGIN} />
		);

		expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/mountains/${mountain.slug}"/>`);
		expect(html).toContain('property="og:title"');
		expect(html).toContain('name="twitter:card"');
		expect(html).not.toContain('noindex');
	});

	it('keeps a draft preview noindex and free of canonical and social tags', () => {
		const html = renderToStaticMarkup(
			<MountainPageView model={{ kind: 'mountain', mountain, preview: true }} siteOrigin={ORIGIN} />
		);

		expect(html).toContain('<meta name="robots" content="noindex, nofollow"/>');
		expect(html).not.toContain('canonical');
		expect(html).not.toContain('og:');
		expect(html).not.toContain('name="description"');
	});

	it('publishes no canonical or social tags for a failed load', () => {
		const html = renderToStaticMarkup(
			<MountainPageView model={{ kind: 'error', reason: 'not-found' }} siteOrigin={ORIGIN} />
		);

		expect(html).toContain('<title>');
		expect(html).not.toContain('canonical');
		expect(html).not.toContain('og:');
	});

	it('canonicalizes the daily page to the homepage', () => {
		const html = renderToStaticMarkup(
			<MountainPageView model={{ kind: 'daily', daily }} siteOrigin={ORIGIN} />
		);

		expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/"/>`);
		expect(html).not.toContain(`/mountains/${daily.mountain.slug}`);
	});

	it('gives the daily page a stable title and one WebSite JSON-LD from the configured origin', () => {
		const html = renderToStaticMarkup(
			<MountainPageView model={{ kind: 'daily', daily }} siteOrigin={ORIGIN} />
		);

		expect(html).toContain('<title>SerendiPeak — Explore Mountains in 3D</title>');
		expect(html).toContain('<meta property="og:title" content="SerendiPeak"/>');
		expect(html).toContain(`"@type":"WebSite","name":"SerendiPeak","url":"${ORIGIN}/"`);
		expect(html.match(/application\/ld\+json/g)).toHaveLength(1);
	});

	it('publishes no structured data on mountain pages or without an origin', () => {
		const mountain = renderToStaticMarkup(
			<MountainPageView
				model={{ kind: 'mountain', mountain: daily.mountain }}
				siteOrigin={ORIGIN}
			/>
		);
		const noOrigin = renderToStaticMarkup(
			<MountainPageView model={{ kind: 'daily', daily }} siteOrigin={null} />
		);

		expect(mountain).not.toContain('ld+json');
		expect(noOrigin).not.toContain('ld+json');
	});

	it('hands the neighbours it was given to the page of a permalink and of the day', () => {
		const nearby = [
			{ slug: 'a', name: 'A', place: 'Chile', elevationMeters: 1000, distanceKm: 10 }
		];
		const permalink = renderToStaticMarkup(
			<MountainPageView
				model={{ kind: 'mountain', mountain }}
				siteOrigin={ORIGIN}
				nearby={nearby}
			/>
		);
		const today = renderToStaticMarkup(
			<MountainPageView model={{ kind: 'daily', daily }} siteOrigin={ORIGIN} nearby={nearby} />
		);

		expect(permalink).toContain('data-nearby="1"');
		expect(today).toContain('data-nearby="1"');
	});

	it('passes none on when the page had none', () => {
		const plain = renderToStaticMarkup(
			<MountainPageView model={{ kind: 'mountain', mountain }} siteOrigin={ORIGIN} />
		);

		expect(plain).toContain('data-nearby="none"');
	});
});
