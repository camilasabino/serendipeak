import type { ReactNode } from 'react';
import { SiteShell } from '../shell/SiteShell';
import { nearbyOf, pageModelOf } from './pageModel';
import { StageLayout } from './StageLayout';

interface AppFrameProps {
	pageProps: object;
	year: number;
	pathname?: string;
	children: ReactNode;
}

export function AppFrame({ pageProps, year, pathname, children }: AppFrameProps) {
	const model = pageModelOf(pageProps);
	const stageModel = model?.kind === 'error' ? undefined : model;

	return (
		<SiteShell layout={stageModel ? 'split' : 'plain'} year={year} pathname={pathname}>
			{stageModel ? (
				<StageLayout model={stageModel} nearby={nearbyOf(pageProps)}>
					{children}
				</StageLayout>
			) : (
				children
			)}
		</SiteShell>
	);
}
