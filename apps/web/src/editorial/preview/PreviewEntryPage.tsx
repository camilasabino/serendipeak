import Head from 'next/head';
import { useEffect, useRef, useState } from 'react';
import { startPreviewSession, type PreviewExchange } from '../../api/HttpMountainApi';
import { documentTitle } from '../../mountain-page/pageCopy';
import { EditorNotice } from '../camera/EditorNotice';
import {
	FAILED_MESSAGE,
	FAILED_TITLE,
	INVALID_MESSAGE,
	INVALID_TITLE,
	OPENING_MESSAGE,
	OPENING_TITLE
} from './copy';
import { parsePreviewFragment } from './previewGrant';

type Stage = 'opening' | 'invalid' | 'failed';

export function PreviewEntryPage() {
	const [stage, setStage] = useState<Stage>('opening');
	const started = useRef(false);

	useEffect(() => {
		// React Strict Mode runs effects twice in development, and the first run removes the token.
		if (started.current) {
			return;
		}
		started.current = true;

		const grant = parsePreviewFragment(window.location.hash);
		// The token leaves the address bar before anything else happens, so it is not in the history
		// entry this page leaves behind.
		window.history.replaceState(null, '', window.location.pathname);
		const exchange: Promise<PreviewExchange> = grant
			? startPreviewSession(grant)
			: Promise.resolve('rejected');

		void exchange.then((result) => {
			if (grant && result === 'started') {
				window.location.replace(`/mountains/${grant.slug}`);
				return;
			}
			setStage(result === 'failed' ? 'failed' : 'invalid');
		});
	}, []);

	return (
		<>
			<Head>
				<title>{documentTitle(OPENING_TITLE)}</title>
				<meta name="robots" content="noindex, nofollow" />
				<meta name="referrer" content="no-referrer" />
			</Head>
			{stage === 'opening' && <EditorNotice title={OPENING_TITLE} message={OPENING_MESSAGE} busy />}
			{stage === 'invalid' && <EditorNotice title={INVALID_TITLE} message={INVALID_MESSAGE} />}
			{stage === 'failed' && <EditorNotice title={FAILED_TITLE} message={FAILED_MESSAGE} />}
		</>
	);
}
