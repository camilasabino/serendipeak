import Head from 'next/head';
import type { MountainPageProps } from './applyPageLoad';
import { ErrorView } from './ErrorView';
import { MountainView } from './MountainView';
import { describeFailure, pageTitle } from './pageCopy';

export function MountainPageView({ model }: MountainPageProps) {
	return (
		<>
			<Head>
				<title>{pageTitle(model)}</title>
			</Head>
			{renderBody(model)}
		</>
	);
}

function renderBody(model: MountainPageProps['model']) {
	switch (model.kind) {
		case 'mountain':
			return <MountainView mountain={model.mountain} />;
		case 'daily':
			return <MountainView mountain={model.daily.mountain} />;
		case 'error':
			return <ErrorView content={describeFailure(model.reason)} />;
	}
}
