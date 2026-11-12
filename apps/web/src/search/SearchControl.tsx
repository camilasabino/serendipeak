import Router from 'next/router';
import { useEffect, useRef, useState, type Ref } from 'react';
import { bindRouteChanges, createNavigate } from '../explore/navigate';
import { focusMountainHeading } from '../mountain-page/focusMountainHeading';
import { useMountainIndex } from '../mountain-index/MountainIndexContext';
import { SEARCH_BUTTON_LABEL, SEARCH_BUTTON_LABEL_SUFFIX } from './searchCopy';
import styles from './SearchControl.module.css';
import { SearchDialog } from './SearchDialog';

function reportNavigationError(error: unknown): void {
	console.error('Opening a search result failed', error);
}

export function SearchButton({
	onOpen,
	buttonRef
}: {
	onOpen: () => void;
	buttonRef?: Ref<HTMLButtonElement>;
}) {
	return (
		<button
			ref={buttonRef}
			type="button"
			className={styles.button}
			aria-haspopup="dialog"
			onClick={onOpen}
		>
			<svg className={styles.icon} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
				<circle cx="8.5" cy="8.5" r="5.5" />
				<path d="m12.6 12.6 4.6 4.6" />
			</svg>
			<span className={styles.label}>{SEARCH_BUTTON_LABEL}</span>
			<span className={styles.hidden}>{SEARCH_BUTTON_LABEL_SUFFIX}</span>
		</button>
	);
}

// The index store belongs to the app, so whatever one search or page loaded serves every later
// search.
export function SearchControl() {
	const store = useMountainIndex();
	const [navigate] = useState(() => createNavigate(() => Router));
	const [open, setOpen] = useState(false);
	const buttonRef = useRef<HTMLButtonElement>(null);

	// A navigation that starts elsewhere (browser Back, a link) leaves no search over the new page.
	useEffect(() => bindRouteChanges(Router.events, () => setOpen(false)), []);

	const openSearch = () => {
		void store.request();
		setOpen(true);
	};

	const dismiss = () => {
		setOpen(false);
		buttonRef.current?.focus();
	};

	// Focus returns to the button first, so the heading of the destination can claim it once shown
	// unless the user moved on meanwhile. A navigation that a newer one replaced moves nothing.
	const select = (slug: string) => {
		dismiss();
		navigate(slug)
			.then((navigated) => {
				if (navigated) {
					focusMountainHeading(buttonRef.current);
				}
			})
			.catch(reportNavigationError);
	};

	return (
		<>
			<SearchButton onOpen={openSearch} buttonRef={buttonRef} />
			{open && <SearchDialog store={store} onClose={dismiss} onSelect={select} />}
		</>
	);
}
