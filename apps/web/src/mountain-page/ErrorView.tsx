import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import type { ErrorContent } from './pageCopy';

export function ErrorView({ content }: { content: ErrorContent }) {
	const router = useRouter();
	const [retrying, setRetrying] = useState(false);

	async function retry() {
		if (retrying) {
			return;
		}

		setRetrying(true);
		try {
			await router.replace(router.asPath);
		} finally {
			setRetrying(false);
		}
	}

	return (
		<main>
			<h1>{content.title}</h1>
			<p role="alert">{content.message}</p>
			{content.retryable && (
				<button type="button" aria-disabled={retrying} aria-busy={retrying} onClick={retry}>
					{retrying ? 'Trying again…' : 'Try again'}
				</button>
			)}
			{router.asPath !== '/' && <Link href="/">Go to today&apos;s mountain</Link>}
		</main>
	);
}
