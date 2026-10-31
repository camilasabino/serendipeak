import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import styles from './ErrorView.module.css';
import type { ErrorContent } from './pageCopy';
import { TopographicMotif } from './TopographicMotif';

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
		<main className={styles.missing}>
			<TopographicMotif className={styles.motif} />
			<section aria-labelledby="error-title" className={styles.content}>
				<h1 id="error-title" className={styles.title}>
					{content.title}
				</h1>
				<p role="alert" className={styles.message}>
					{content.message}
				</p>
				<div className={styles.actions}>
					{content.retryable && (
						<button
							type="button"
							className={styles.action}
							aria-disabled={retrying}
							aria-busy={retrying}
							onClick={retry}
						>
							{retrying ? 'Trying again…' : 'Try again'}
						</button>
					)}
					{router.pathname !== '/' && (
						<Link href="/" className={content.retryable ? styles.quiet : styles.action}>
							Go to today&apos;s mountain
						</Link>
					)}
				</div>
			</section>
		</main>
	);
}
