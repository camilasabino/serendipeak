import type { GetServerSideProps } from 'next';
import { createServerMountainApi } from '../api/serverMountainApi';
import { AtlasPageView, type AtlasPageProps } from '../atlas/AtlasPageView';
import { ATLAS_PATH, legacyRedirect } from '../atlas/atlasQuery';
import { loadAtlasPage } from '../atlas/loadAtlasPage';
import { canonicalUrl } from '../config/siteOrigin';
import { applyPageLoad } from '../mountain-page/applyPageLoad';

export const getServerSideProps: GetServerSideProps<AtlasPageProps> = async ({ res, query }) => {
	const load = await loadAtlasPage(createServerMountainApi());
	const destination = legacyRedirect(
		query,
		load.model.kind === 'atlas' ? load.model.mountains : undefined
	);
	if (destination) {
		return { redirect: { destination, permanent: false } };
	}

	const { props } = applyPageLoad(res, load);
	return {
		props: {
			...props,
			canonicalUrl: canonicalUrl(ATLAS_PATH, { SITE_ORIGIN: process.env.SITE_ORIGIN })
		}
	};
};

export default AtlasPageView;
