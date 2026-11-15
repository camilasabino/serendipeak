import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
	copyLink,
	readShareEnvironment,
	resolveShareUrl,
	shareLink,
	type MountainShare,
	type ShareOutcome
} from './shareLink';
import styles from './ShareControl.module.css';

export const COPY_LINK_LABEL = 'Copy link';
export const SHARE_LABEL = 'Share';
export const SHARED_MESSAGE = 'Link shared.';
export const COPIED_MESSAGE = 'Link copied.';
export const COPY_FAILED_MESSAGE = "Couldn't copy the link. You can copy it from here:";

const FEEDBACK_MS = 4000;

export type ShareFeedback =
	{ status: 'idle' } | { status: 'shared' | 'copied' } | { status: 'failed'; url: string };

export function feedbackFor(outcome: ShareOutcome, url: string): ShareFeedback {
	switch (outcome) {
		case 'shared':
		case 'copied':
			return { status: outcome };
		case 'failed':
			return { status: 'failed', url };
		case 'cancelled':
			return { status: 'idle' };
	}
}

function feedbackText(feedback: ShareFeedback): string {
	switch (feedback.status) {
		case 'shared':
			return SHARED_MESSAGE;
		case 'copied':
			return COPIED_MESSAGE;
		case 'failed':
			return `${COPY_FAILED_MESSAGE} ${feedback.url}`;
		case 'idle':
			return '';
	}
}

interface ShareButtonProps {
	native: boolean;
	feedback: ShareFeedback;
	onShare: () => void;
	onCopy: () => void;
}

export function ShareButton({ native, feedback, onShare, onCopy }: ShareButtonProps) {
	return (
		<div className={styles.share}>
			<div className={styles.actions}>
				{native && (
					<button type="button" className={styles.button} onClick={onShare}>
						{SHARE_LABEL}
					</button>
				)}
				<button type="button" className={styles.button} onClick={onCopy}>
					{COPY_LINK_LABEL}
				</button>
			</div>
			{feedback.status !== 'idle' && (
				<p className={styles.status} role="status">
					{feedback.status === 'failed' ? (
						<>
							{COPY_FAILED_MESSAGE} <span className={styles.url}>{feedback.url}</span>
						</>
					) : (
						feedbackText(feedback)
					)}
				</p>
			)}
		</div>
	);
}

interface ShareControlProps {
	title: string;
	share: MountainShare;
}

const subscribeNever = () => () => {};
const supportsNativeShare = () => typeof navigator.share === 'function';
const serverSupport = () => false;

// Native sharing is only known in the browser; the server and the first client render both show
// the clipboard action, so hydration matches.
export function ShareControl({ title, share }: ShareControlProps) {
	const native = useSyncExternalStore(subscribeNever, supportsNativeShare, serverSupport);
	const [feedback, setFeedback] = useState<ShareFeedback>({ status: 'idle' });
	const sharing = useRef(false);

	useEffect(() => {
		if (feedback.status === 'idle' || feedback.status === 'failed') {
			return;
		}

		const timer = setTimeout(() => setFeedback({ status: 'idle' }), FEEDBACK_MS);

		return () => clearTimeout(timer);
	}, [feedback]);

	async function run(action: typeof shareLink) {
		if (sharing.current) {
			return;
		}

		sharing.current = true;
		try {
			const url = resolveShareUrl(share, window.location.origin);
			const outcome = await action({ title, url }, readShareEnvironment(navigator));
			setFeedback(feedbackFor(outcome, url));
		} finally {
			sharing.current = false;
		}
	}

	return (
		<ShareButton
			native={native}
			feedback={feedback}
			onShare={() => void run(shareLink)}
			onCopy={() => void run(({ url }, environment) => copyLink(url, environment))}
		/>
	);
}
