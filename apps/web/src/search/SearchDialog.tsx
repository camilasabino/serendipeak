import {
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type KeyboardEvent,
	type Ref
} from 'react';
import type { MountainIndexEntry } from '../api/contract';
import { moveActiveOption } from './activeOption';
import { describeEntry } from '../mountain-index/describeEntry';
import { findMountains, prepareIndex } from './findMountains';
import { foldName } from './foldName';
import type { MountainIndexState, MountainIndexStore } from '../mountain-index/MountainIndexStore';
import {
	CLOSE_LABEL,
	failureMessage,
	HINT_CLOSE,
	HINT_MOVE,
	HINT_OPEN,
	LOADING_MESSAGE,
	promptMessage,
	resultsMessage,
	RETRY_LABEL,
	SEARCH_DIALOG_TITLE,
	SEARCH_INPUT_LABEL,
	SEARCH_INPUT_PLACEHOLDER,
	SEARCH_RESULTS_LABEL
} from './searchCopy';
import styles from './SearchDialog.module.css';

interface SearchDialogProps {
	store: MountainIndexStore;
	/** Called once the dialog closed itself: Escape, the Close button or a click outside the panel. */
	onClose: () => void;
	onSelect: (slug: string) => void;
}

// Mounted only while search is open, so every opening starts with an empty query.
export function SearchDialog({ store, onClose, onSelect }: SearchDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

	// The modal opens from an effect because showModal() is imperative; the guard keeps a second
	// Strict Mode mount from calling it on an open dialog, which throws.
	useEffect(() => {
		const dialog = dialogRef.current;
		if (dialog && !dialog.open) {
			dialog.showModal();
		}
		inputRef.current?.focus();
	}, []);

	const close = () => dialogRef.current?.close();
	const retry = () => {
		inputRef.current?.focus();
		void store.request();
	};

	return (
		<dialog
			ref={dialogRef}
			className={styles.dialog}
			aria-labelledby="mountain-search-title"
			onClose={onClose}
			onClick={(event) => {
				// The panel fills the dialog box, so only a click on the backdrop targets the dialog.
				if (event.target === event.currentTarget) {
					close();
				}
			}}
		>
			<div className={styles.panel}>
				<div className={styles.top}>
					<h2 id="mountain-search-title" className={styles.title}>
						{SEARCH_DIALOG_TITLE}
					</h2>
					<button type="button" className={styles.close} onClick={close}>
						<svg
							className={styles.closeIcon}
							viewBox="0 0 20 20"
							aria-hidden="true"
							focusable="false"
						>
							<path d="m5 5 10 10M15 5 5 15" />
						</svg>
						<span>{CLOSE_LABEL}</span>
					</button>
				</div>
				<SearchCombobox state={state} inputRef={inputRef} onSelect={onSelect} onRetry={retry} />
			</div>
		</dialog>
	);
}

interface SearchComboboxProps {
	state: MountainIndexState;
	inputRef?: Ref<HTMLInputElement>;
	onSelect: (slug: string) => void;
	onRetry: () => void;
	initialQuery?: string;
}

export function SearchCombobox({
	state,
	inputRef,
	onSelect,
	onRetry,
	initialQuery = ''
}: SearchComboboxProps) {
	const id = useId();
	const listId = `${id}-results`;
	const [query, setQuery] = useState(initialQuery);
	const [active, setActive] = useState(-1);
	const index = useMemo(
		() => (state.status === 'ready' ? prepareIndex(state.mountains) : undefined),
		[state]
	);
	const results = useMemo(() => (index ? findMountains(index, query) : []), [index, query]);
	const activeEntry: MountainIndexEntry | undefined = results[active];
	const optionId = (slug: string) => `${id}-option-${slug}`;
	const activeId = activeEntry ? optionId(activeEntry.slug) : undefined;

	useEffect(() => {
		if (activeId) {
			document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
		}
	}, [activeId]);

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		const { key } = event;
		if (key === 'ArrowDown' || key === 'ArrowUp') {
			event.preventDefault();
			setActive((current) => moveActiveOption(current, results.length, key));
		} else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
			event.preventDefault();
			// Typing never selects: only an option made active with the arrow keys is opened.
			if (activeEntry) {
				onSelect(activeEntry.slug);
			}
		}
	};

	const expanded = results.length > 0;
	const waiting = state.status === 'idle' || state.status === 'loading';

	return (
		<div className={styles.search}>
			<div className={styles.field}>
				<label className={styles.label} htmlFor={`${id}-input`}>
					{SEARCH_INPUT_LABEL}
				</label>
				<svg className={styles.fieldIcon} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
					<circle cx="8.5" cy="8.5" r="5.5" />
					<path d="m12.6 12.6 4.6 4.6" />
				</svg>
				<input
					ref={inputRef}
					id={`${id}-input`}
					className={styles.input}
					type="text"
					role="combobox"
					aria-autocomplete="list"
					aria-expanded={expanded}
					aria-controls={expanded ? listId : undefined}
					aria-activedescendant={activeId}
					autoComplete="off"
					autoCapitalize="off"
					spellCheck={false}
					enterKeyHint="go"
					placeholder={SEARCH_INPUT_PLACEHOLDER}
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setActive(-1);
					}}
					onKeyDown={onKeyDown}
				/>
			</div>
			<div className={styles.notice} data-waiting={waiting || undefined}>
				{state.status === 'failed' && (
					<svg
						className={styles.noticeIcon}
						viewBox="0 0 24 24"
						aria-hidden="true"
						focusable="false"
					>
						<circle cx="12" cy="12" r="8.5" />
						<path d="M12 7.5v5.5" />
						<circle cx="12" cy="16.3" r=".7" fill="currentColor" />
					</svg>
				)}
				<p className={styles.status} role="status">
					{statusMessage(state, query, results.length)}
				</p>
			</div>
			{state.status === 'failed' && (
				<button type="button" className={styles.retry} onClick={onRetry}>
					{RETRY_LABEL}
				</button>
			)}
			{expanded && (
				<ul id={listId} className={styles.results} role="listbox" aria-label={SEARCH_RESULTS_LABEL}>
					{results.map((entry) => (
						<li
							key={entry.slug}
							id={optionId(entry.slug)}
							className={styles.option}
							role="option"
							aria-selected={entry === activeEntry}
							onClick={() => onSelect(entry.slug)}
						>
							<span className={styles.name}>{entry.name}</span>
							<span className={styles.detail}>{describeEntry(entry)}</span>
						</li>
					))}
				</ul>
			)}
			{expanded && (
				<p className={styles.hints} aria-hidden="true">
					<span>
						<kbd>↑</kbd>
						<kbd>↓</kbd> {HINT_MOVE}
					</span>
					<span>
						<kbd>Enter</kbd> {HINT_OPEN}
					</span>
					<span>
						<kbd>Esc</kbd> {HINT_CLOSE}
					</span>
				</p>
			)}
		</div>
	);
}

function statusMessage(state: MountainIndexState, query: string, count: number): string {
	switch (state.status) {
		case 'idle':
		case 'loading':
			return LOADING_MESSAGE;
		case 'failed':
			return failureMessage(state.reason);
		case 'ready':
			return foldName(query) === ''
				? promptMessage(state.mountains.length)
				: resultsMessage(count, query);
	}
}
