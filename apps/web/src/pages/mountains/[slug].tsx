import type { GetServerSideProps } from 'next';
import { createServerMountainApi } from '../../api/serverMountainApi';
import { parsePreviewGrant } from '../../editorial/preview/previewGrant';
import {
	applyPageLoad,
	applyPermanentRedirect,
	type MountainPageProps
} from '../../mountain-page/applyPageLoad';
import { loadMountainPage } from '../../mountain-page/loadMountainPage';
import { loadMountainPreviewPage } from '../../mountain-page/loadMountainPreviewPage';
import { MountainPageView } from '../../mountain-page/MountainPageView';
import { isPermanentRedirect } from '../../mountain-page/pageModel';

export const getServerSideProps: GetServerSideProps<MountainPageProps> = async ({
	params,
	res,
	preview,
	previewData
}) => {
	const slug = params?.slug;
	if (typeof slug !== 'string') {
		return { notFound: true };
	}

	const api = createServerMountainApi();
	const load = preview
		? await loadMountainPreviewPage(api, slug, parsePreviewGrant(previewData))
		: await loadMountainPage(api, slug);

	return isPermanentRedirect(load) ? applyPermanentRedirect(res, load) : applyPageLoad(res, load);
};

export default function MountainPage({ model }: MountainPageProps) {
	return <MountainPageView model={model} />;
}
