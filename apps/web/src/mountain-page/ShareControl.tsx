import {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	useSyncExternalStore,
	type ReactNode,
	type Ref
} from 'react';
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

function announcementFor(feedback: ShareFeedback): string {
	switch (feedback.status) {
		case 'shared':
			return SHARED_MESSAGE;
		case 'copied':
			return COPIED_MESSAGE;
		case 'failed':
		case 'idle':
			return '';
	}
}

export function shareButtonLabel(title: string): string {
	return `${SHARE_LABEL} ${title}`;
}

export function copyFallbackLabel(title: string): string {
	return `Link to ${title}`;
}

export interface Dismissal {
	/** Escape returns focus to Copy link; a click or Tab elsewhere leaves it where the visitor put it. */
	restoreFocus: boolean;
}

interface ShareButtonProps {
	title: string;
	native: boolean;
	feedback: ShareFeedback;
	onShare: () => void;
	onCopy: () => void;
	onDismiss: (dismissal: Dismissal) => void;
	copyRef?: Ref<HTMLButtonElement>;
}

export function ShareButton({
	title,
	native,
	feedback,
	onShare,
	onCopy,
	onDismiss,
	copyRef
}: ShareButtonProps) {
	const boundary = useRef<HTMLDivElement>(null);
	const failed = feedback.status === 'failed';
	const shared = feedback.status === 'shared';
	const copied = feedback.status === 'copied';

	useEffect(() => {
		if (!failed) {
			return;
		}

		const dismissOutside = (event: PointerEvent) => {
			const inside = event.target instanceof Node && boundary.current?.contains(event.target);
			if (!inside) {
				onDismiss({ restoreFocus: false });
			}
		};
		const dismissOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				onDismiss({ restoreFocus: true });
			}
		};

		document.addEventListener('pointerdown', dismissOutside);
		document.addEventListener('keydown', dismissOnEscape);

		return () => {
			document.removeEventListener('pointerdown', dismissOutside);
			document.removeEventListener('keydown', dismissOnEscape);
		};
	}, [failed, onDismiss]);

	return (
		<div
			ref={boundary}
			className={styles.share}
			onBlur={(event) => {
				// A null target is the window or tab losing focus, which is not a decision to leave.
				const left =
					event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget);
				if (failed && left) {
					onDismiss({ restoreFocus: false });
				}
			}}
		>
			<span role="group" aria-label={SHARE_LABEL} className={styles.group}>
				{native && (
					<ActionButton
						label={shareButtonLabel(title)}
						tip={shared ? SHARED_MESSAGE : SHARE_LABEL}
						done={shared}
						icon={shared ? <CheckIcon /> : <ShareIcon />}
						onClick={onShare}
					/>
				)}
				<ActionButton
					label={COPY_LINK_LABEL}
					tip={copied ? COPIED_MESSAGE : COPY_LINK_LABEL}
					done={copied}
					icon={copied ? <CheckIcon /> : <LinkIcon />}
					onClick={onCopy}
					buttonRef={copyRef}
				/>
			</span>
			<span aria-live="polite" aria-atomic="true" className={styles.hidden}>
				{announcementFor(feedback)}
			</span>
			{feedback.status === 'failed' && <CopyFallback title={title} attempt={feedback} />}
		</div>
	);
}

interface ActionButtonProps {
	label: string;
	tip: string;
	done: boolean;
	icon: ReactNode;
	onClick: () => void;
	buttonRef?: Ref<HTMLButtonElement>;
}

// The name comes from aria-label, so the tip is a courtesy that assistive technology skips.
function ActionButton({ label, tip, done, icon, onClick, buttonRef }: ActionButtonProps) {
	return (
		<button
			ref={buttonRef}
			type="button"
			className={styles.button}
			aria-label={label}
			data-done={done || undefined}
			onClick={onClick}
		>
			{icon}
			<span className={styles.tip} aria-hidden="true">
				{tip}
			</span>
		</button>
	);
}

// Focus lands on the read-only field with the link selected, which is the next thing a visitor
// whose clipboard was refused needs to do. Each failed attempt is a new object, so a retry that
// fails again brings focus back to the field instead of leaving it silent on the button.
function CopyFallback({
	title,
	attempt
}: {
	title: string;
	attempt: Extract<ShareFeedback, { status: 'failed' }>;
}) {
	const field = useRef<HTMLInputElement>(null);
	const messageId = useId();

	useEffect(() => {
		const input = field.current;
		if (!input) {
			return;
		}

		input.focus();
		input.select();
		// Selecting scrolls a long link to its end; the start is what identifies it.
		input.scrollLeft = 0;
	}, [attempt]);

	return (
		<div role="group" aria-labelledby={messageId} className={styles.popover}>
			<p id={messageId} className={styles.message}>
				{COPY_FAILED_MESSAGE}
			</p>
			<input
				ref={field}
				readOnly
				value={attempt.url}
				aria-label={copyFallbackLabel(title)}
				aria-describedby={messageId}
				className={styles.field}
			/>
		</div>
	);
}

function Icon({ children }: { children: ReactNode }) {
	return (
		<svg
			className={styles.icon}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}

function ShareIcon() {
	return (
		<Icon>
			<path d="M12 3v12M7 8l5-5 5 5" />
			<path d="M5 13v6.5h14V13" />
		</Icon>
	);
}

function LinkIcon() {
	return (
		<Icon>
			<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
			<path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
		</Icon>
	);
}

function CheckIcon() {
	return (
		<Icon>
			<path d="M5 12.5l4.5 4.5L19 7.5" />
		</Icon>
	);
}

interface ShareControlProps {
	title: string;
	share: MountainShare;
}

const subscribeNever = () => () => {};
const supportsNativeShare = () => typeof navigator.share === 'function';
const serverSupport = () => false;

const IDLE: ShareFeedback = { status: 'idle' };

// Native sharing is only known in the browser; the server and the first client render both show
// the clipboard action, so hydration matches.
export function ShareControl({ title, share }: ShareControlProps) {
	const native = useSyncExternalStore(subscribeNever, supportsNativeShare, serverSupport);
	const [feedback, setFeedback] = useState<ShareFeedback>(IDLE);
	const copyButton = useRef<HTMLButtonElement>(null);
	const sharing = useRef(false);

	useEffect(() => {
		if (feedback.status === 'idle' || feedback.status === 'failed') {
			return;
		}

		const timer = setTimeout(() => setFeedback(IDLE), FEEDBACK_MS);

		return () => clearTimeout(timer);
	}, [feedback]);

	const dismiss = useCallback(({ restoreFocus }: Dismissal) => {
		setFeedback((current) => (current.status === 'failed' ? IDLE : current));
		if (restoreFocus) {
			copyButton.current?.focus();
		}
	}, []);

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
			title={title}
			native={native}
			feedback={feedback}
			copyRef={copyButton}
			onShare={() => void run(shareLink)}
			onCopy={() => void run(({ url }, environment) => copyLink(url, environment))}
			onDismiss={dismiss}
		/>
	);
}
