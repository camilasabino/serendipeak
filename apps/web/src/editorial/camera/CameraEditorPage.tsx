import Head from 'next/head';
import { useRouter } from 'next/router';
import { InvalidPublicConfigError, readPublicConfig } from '../../config/readPublicConfig';
import { documentTitle } from '../../mountain-page/pageCopy';
import { CameraEditor } from './CameraEditor';
import {
	EDITOR_TITLE,
	INVALID_LINK_MESSAGE,
	INVALID_LINK_TITLE,
	MISSING_CONFIG_MESSAGE,
	MISSING_CONFIG_TITLE,
	OPENING_LABEL
} from './copy';
import { EditorNotice } from './EditorNotice';
import { parseEditorQuery } from './editorQuery';

// Next inlines NEXT_PUBLIC_* only for literal reads. The Admin is served by the API's Django, so
// its address is the API base URL.
function adminBaseUrl(): string | undefined {
	try {
		return readPublicConfig({ NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL })
			.apiBaseUrl;
	} catch (error) {
		if (error instanceof InvalidPublicConfigError) {
			return undefined;
		}
		throw error;
	}
}

export function CameraEditorPage() {
	const router = useRouter();

	return (
		<>
			<Head>
				<title>{documentTitle(EDITOR_TITLE)}</title>
				<meta name="robots" content="noindex, nofollow" />
			</Head>
			{router.isReady ? (
				<Body query={router.query} />
			) : (
				<EditorNotice title={EDITOR_TITLE} message={OPENING_LABEL} busy />
			)}
		</>
	);
}

function Body({ query }: { query: ReturnType<typeof useRouter>['query'] }) {
	const parsed = parseEditorQuery(query);
	if (!parsed.ok) {
		return <EditorNotice title={INVALID_LINK_TITLE} message={INVALID_LINK_MESSAGE} />;
	}
	const base = adminBaseUrl();
	if (!base) {
		return <EditorNotice title={MISSING_CONFIG_TITLE} message={MISSING_CONFIG_MESSAGE} />;
	}

	return <CameraEditor request={parsed.request} adminBaseUrl={base} />;
}
