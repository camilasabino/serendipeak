import Head from 'next/head';
import { ErrorView } from '../mountain-page/ErrorView';
import { documentTitle } from '../mountain-page/pageCopy';
import type { AtlasModel, ErrorModel } from '../mountain-page/pageModel';
import { ATLAS_DESCRIPTION, ATLAS_LOAD_FAILED, ATLAS_TITLE } from './atlasCopy';
import { AtlasPanel } from './AtlasPanel';

export interface AtlasPageProps {
	model: AtlasModel | ErrorModel;
	/** Absent when the site origin is not configured; the page is then left without one. */
	canonicalUrl: string | null;
}

// The canonical always names the bare atlas, whatever query the page was reached with.
export function AtlasPageView({ model, canonicalUrl }: AtlasPageProps) {
	if (model.kind === 'error') {
		return (
			<>
				<Head>
					<title>{documentTitle(ATLAS_LOAD_FAILED.title)}</title>
				</Head>
				<ErrorView content={ATLAS_LOAD_FAILED} />
			</>
		);
	}

	return (
		<>
			<Head>
				<title>{ATLAS_TITLE}</title>
				<meta name="description" content={ATLAS_DESCRIPTION} />
				{canonicalUrl && <link rel="canonical" href={canonicalUrl} />}
			</Head>
			<AtlasPanel mountains={model.mountains} />
		</>
	);
}
