import type { GetServerSideProps } from 'next';
import { createServerMountainApi } from '../../api/serverMountainApi';
import { applyPageLoad, type MountainPageProps } from '../../mountain-page/applyPageLoad';
import { loadMountainPage } from '../../mountain-page/loadMountainPage';
import { MountainPageView } from '../../mountain-page/MountainPageView';

export const getServerSideProps: GetServerSideProps<MountainPageProps> = async ({
	params,
	res
}) => {
	const slug = params?.slug;
	if (typeof slug !== 'string') {
		return { notFound: true };
	}

	const load = await loadMountainPage(createServerMountainApi(), slug);

	return applyPageLoad(res, load);
};

export default function MountainPage({ model }: MountainPageProps) {
	return <MountainPageView model={model} />;
}
