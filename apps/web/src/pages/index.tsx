import type { GetServerSideProps } from 'next';
import { createServerMountainApi } from '../api/serverMountainApi';
import { applyPageLoad, type MountainPageProps } from '../mountain-page/applyPageLoad';
import { loadDailyPage } from '../mountain-page/loadDailyPage';
import { MountainPageView } from '../mountain-page/MountainPageView';

export const getServerSideProps: GetServerSideProps<MountainPageProps> = async ({ res }) => {
	const load = await loadDailyPage(createServerMountainApi());

	return applyPageLoad(res, load);
};

export default function DailyMountainPage({ model }: MountainPageProps) {
	return <MountainPageView model={model} />;
}
