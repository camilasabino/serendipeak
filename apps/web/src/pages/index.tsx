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

export default function DailyMountainPage(props: MountainPageProps) {
	return <MountainPageView {...props} />;
}
