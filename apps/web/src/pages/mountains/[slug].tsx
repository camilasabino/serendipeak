import type { GetServerSideProps } from 'next';
import { createServerMountainApi } from '../../api/serverMountainApi';
import { siteOriginProp } from '../../config/siteOrigin';
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

	if (isPermanentRedirect(load)) {
		return applyPermanentRedirect(res, load);
	}

	const { props } = applyPageLoad(res, load);

	return { props: { ...props, siteOrigin: siteOriginProp() } };
};

export default function MountainPage(props: MountainPageProps) {
	return <MountainPageView {...props} />;
}
