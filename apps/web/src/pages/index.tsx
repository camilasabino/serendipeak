import type { GetServerSideProps } from 'next';
import { createServerMountainApi } from '../api/serverMountainApi';
import { siteOriginProp } from '../config/siteOrigin';
import { applyPageLoad, type MountainPageProps } from '../mountain-page/applyPageLoad';
import { loadDailyPage } from '../mountain-page/loadDailyPage';
import { MountainPageView } from '../mountain-page/MountainPageView';
import { loadNearbyFor } from '../nearby/loadNearbyMountains';

export const getServerSideProps: GetServerSideProps<MountainPageProps> = async ({ res }) => {
	const api = createServerMountainApi();
	const load = await loadDailyPage(api);

	const { props } = applyPageLoad(res, load);
	const nearby = await loadNearbyFor(api, props.model);

	return { props: { ...props, nearby, siteOrigin: siteOriginProp() } };
};

// The same component for every mountain route, so React keeps the sheet, and the Explore control in
// it, mounted while a visitor explores from Today to a permalink and on to the next mountain.
export default MountainPageView;
