import type { GetServerSideProps } from 'next';
import { ABOUT_PATH } from '../about/aboutCopy';
import { AboutPage, type AboutPageProps } from '../about/AboutPage';
import { canonicalUrl } from '../config/siteOrigin';

// Server-rendered because the origin is read at request time, not baked in at build. Next marks
// such a page uncacheable by default, so the page keeps the public lifetime a static page had.
const ABOUT_CACHE_CONTROL = 'public, max-age=0, s-maxage=300';

export const getServerSideProps: GetServerSideProps<AboutPageProps> = async ({ res }) => {
	res.setHeader('Cache-Control', ABOUT_CACHE_CONTROL);

	return {
		props: { canonicalUrl: canonicalUrl(ABOUT_PATH, { SITE_ORIGIN: process.env.SITE_ORIGIN }) }
	};
};

export default AboutPage;
