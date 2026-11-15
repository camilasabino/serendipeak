import type { GetServerSideProps } from 'next';
import { createServerMountainApi } from '../api/serverMountainApi';
import { sitemapResponse } from '../seo/crawlResponses';
import { sendCrawlResponse } from '../seo/sendCrawlResponse';

// The document is written here and the page is never rendered: Pages Router has no other way to
// serve a dynamic file at a path with an extension.
export const getServerSideProps: GetServerSideProps = async ({ res }) => {
	sendCrawlResponse(
		res,
		await sitemapResponse(createServerMountainApi(), { SITE_ORIGIN: process.env.SITE_ORIGIN })
	);

	return { props: {} };
};

export default function Sitemap() {
	return null;
}
