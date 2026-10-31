import type { ReactNode } from 'react';
import { SiteShell } from '../shell/SiteShell';
import { MountainLayout } from './MountainLayout';
import { MountainNavigation } from './MountainNavigation';
import { pageModelOf } from './pageModel';

interface AppFrameProps {
	pageProps: object;
	year: number;
	children: ReactNode;
}

export function AppFrame({ pageProps, year, children }: AppFrameProps) {
	const model = pageModelOf(pageProps);
	const mountainModel = model?.kind === 'error' ? undefined : model;

	return (
		<SiteShell
			layout={mountainModel ? 'split' : 'plain'}
			year={year}
			navigation={mountainModel && <MountainNavigation model={mountainModel} />}
		>
			{mountainModel ? <MountainLayout model={mountainModel}>{children}</MountainLayout> : children}
		</SiteShell>
	);
}
