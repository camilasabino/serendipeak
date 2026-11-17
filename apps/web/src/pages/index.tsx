import type { GetServerSideProps } from 'next';
import { createServerMountainApi } from '../api/serverMountainApi';
import { siteOriginProp } from '../config/siteOrigin';
import { applyPageLoad, type MountainPageProps } from '../mountain-page/applyPageLoad';
import { loadDailyPage } from '../mountain-page/loadDailyPage';
import { MountainPageView } from '../mountain-page/MountainPageView';

export const getServerSideProps: GetServerSideProps<MountainPageProps> = async ({ res }) => {
	const load = await loadDailyPage(createServerMountainApi());

	const { props } = applyPageLoad(res, load);

	return { props: { ...props, siteOrigin: siteOriginProp() } };
};

// The same component for every mountain route, so React keeps the sheet, and the Explore control in
// it, mounted while a visitor explores from Today to a permalink and on to the next mountain.
export default MountainPageView;
