import Head from 'next/head';
import type { MountainPageProps } from './applyPageLoad';
import { ErrorView } from './ErrorView';
import { MountainView } from './MountainView';
import { websiteStructuredData } from '../seo/websiteStructuredData';
import { describeFailure, pageTitle } from './pageCopy';
import { socialDescriptorFor, socialTags } from './socialMetadata';

export function MountainPageView({ model, siteOrigin, nearby }: MountainPageProps) {
	const social = socialDescriptorFor(model, siteOrigin);

	return (
		<>
			<Head>
				<title>{pageTitle(model)}</title>
				{model.kind === 'mountain' && model.preview && (
					<meta name="robots" content="noindex, nofollow" />
				)}
				{social && socialTags(social)}
				{model.kind === 'daily' && websiteStructuredData(siteOrigin)}
			</Head>
			{renderBody(model, siteOrigin, nearby)}
		</>
	);
}

function renderBody(
	model: MountainPageProps['model'],
	siteOrigin: string | null,
	nearby: MountainPageProps['nearby']
) {
	switch (model.kind) {
		case 'mountain':
			return (
				<MountainView
					mountain={model.mountain}
					daily={false}
					preview={model.preview === true}
					siteOrigin={siteOrigin}
					nearby={nearby}
				/>
			);
		case 'daily':
			return (
				<MountainView
					mountain={model.daily.mountain}
					daily
					siteOrigin={siteOrigin}
					nearby={nearby}
				/>
			);
		case 'error':
			return <ErrorView content={describeFailure(model.reason)} />;
	}
}
