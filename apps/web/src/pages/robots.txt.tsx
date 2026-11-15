import type { GetServerSideProps } from 'next';
import { robotsResponse } from '../seo/crawlResponses';
import { sendCrawlResponse } from '../seo/sendCrawlResponse';

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
	sendCrawlResponse(res, robotsResponse({ SITE_ORIGIN: process.env.SITE_ORIGIN }));

	return { props: {} };
};

export default function Robots() {
	return null;
}
