import {
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent
} from 'react';
import { moveActiveOption } from '../search/activeOption';
import { choicesFound } from './atlasCopy';
import { searchChoices, type ChoiceOption } from './choiceSearch';
import { FilterPopup } from './FilterPopup';
import popup from './FilterPopup.module.css';
import controls from './AtlasControls.module.css';
import styles from './ChoiceFilter.module.css';

interface ChoiceFilterProps {
	label: string;
	/** Names the search field of the open popup. */
	searchLabel: string;
	/** The first choice, which leaves the filter off. */
	anyLabel: string;
	options: readonly ChoiceOption[];
	value: string | null;
	onChange: (value: string | null) => void;
	noMatchesMessage: (query: string) => string;
	/** Why there is nothing to choose, when there is: the button then stays but does not open. */
	unavailable?: string;
}

/** The popup's first row; no real choice has an empty value. */
const ANY = '';

function mountainNoun(count: number): string {
	return count === 1 ? 'mountain' : 'mountains';
}

/** Keeps an option inside the visible part of its scrolling list, without moving anything else. */
function reveal(list: HTMLElement, option: HTMLElement, centered: boolean) {
	const above = option.offsetTop;
	const below = above + option.offsetHeight;
	if (centered) {
		list.scrollTop = above - (list.clientHeight - option.offsetHeight) / 2;
	} else if (above < list.scrollTop) {
		list.scrollTop = above;
	} else if (below > list.scrollTop + list.clientHeight) {
		list.scrollTop = below - list.clientHeight;
	}
}

/**
 * A single choice among many, picked from a popup with a search field. It follows the select-only
 * combobox pattern: the button opens a popup whose search field holds focus and drives a listbox
 * through `aria-activedescendant`, so options are chosen by keyboard, pointer or touch alike. A
 * choice that is a descendant of another shows its place in the tree: indented while browsing, and
 * with the names above it while searching, when the tree is out of view.
 */
export function ChoiceFilter({
	label,
	searchLabel,
	anyLabel,
	options,
	value,
	onChange,
	noMatchesMessage,
	unavailable
}: ChoiceFilterProps) {
	const [open, setOpen] = useState(false);
	const labelId = useId();
	const hintId = useId();
	const valueId = useId();
	const popupId = useId();
	const trigger = useRef<HTMLButtonElement>(null);
	const selected = options.find((option) => option.value === value);
	// The popup is not rendered while the filter is unavailable, so it is not expanded either.
	const expanded = open && !unavailable;

	const dismiss = (restoreFocus: boolean) => {
		setOpen(false);
		if (restoreFocus) {
			trigger.current?.focus();
		}
	};

	return (
		<div className={controls.field}>
			<div className={controls.fieldHead}>
				<span className={controls.fieldLabel} id={labelId}>
					{label}
				</span>
				{unavailable && (
					<span className={controls.fieldHint} id={hintId}>
						{unavailable}
					</span>
				)}
			</div>
			<button
				ref={trigger}
				type="button"
				className={controls.trigger}
				aria-haspopup="listbox"
				aria-expanded={expanded}
				aria-controls={expanded ? popupId : undefined}
				aria-labelledby={`${labelId} ${valueId}`}
				aria-describedby={unavailable ? hintId : undefined}
				aria-disabled={unavailable ? true : undefined}
				data-active={selected !== undefined || undefined}
				onClick={() => !unavailable && setOpen(!open)}
				onKeyDown={(event) => {
					if (unavailable) {
						return;
					}
					if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
						event.preventDefault();
						setOpen(true);
					}
				}}
			>
				<span id={valueId} className={controls.triggerValue}>
					<span className={controls.triggerText}>{selected?.label ?? anyLabel}</span>
					{selected && selected.trail.length > 0 && (
						<span className={controls.triggerContext}>{selected.trail.join(' › ')}</span>
					)}
				</span>
				<svg className={controls.chevron} viewBox="0 0 24 24" aria-hidden="true">
					<path d="M6 9l6 6 6-6" />
				</svg>
			</button>
			{expanded && (
				<FilterPopup id={popupId} anchor={trigger} onDismiss={dismiss}>
					<ChoiceList
						searchLabel={searchLabel}
						anyLabel={anyLabel}
						options={options}
						value={value}
						noMatchesMessage={noMatchesMessage}
						onPick={(next) => {
							onChange(next);
							dismiss(true);
						}}
					/>
				</FilterPopup>
			)}
		</div>
	);
}

interface ChoiceListProps {
	searchLabel: string;
	anyLabel: string;
	options: readonly ChoiceOption[];
	value: string | null;
	noMatchesMessage: (query: string) => string;
	onPick: (value: string | null) => void;
}

// Mounted only while the popup is open, so every opening starts with an empty search.
function ChoiceList({
	searchLabel,
	anyLabel,
	options,
	value,
	noMatchesMessage,
	onPick
}: ChoiceListProps) {
	const id = useId();
	const listId = `${id}-list`;
	const input = useRef<HTMLInputElement>(null);
	const list = useRef<HTMLUListElement>(null);
	const [query, setQuery] = useState('');
	const searching = query.trim() !== '';
	const tree = options.some(({ depth }) => depth > 0);

	// "All" is a choice only while nothing is being searched for.
	const rows = useMemo(() => {
		const any: ChoiceOption = { value: ANY, label: anyLabel, count: 0, depth: 0, trail: [] };
		const found = searchChoices(options, query);

		return searching ? found : [any, ...found];
	}, [options, query, searching, anyLabel]);

	const initial = Math.max(
		0,
		rows.findIndex((row) => row.value === (value ?? ANY))
	);
	const [active, setActive] = useState(initial);
	const optionId = (index: number) => `${id}-option-${index}`;
	const activeId = rows[active] ? optionId(active) : undefined;
	const firstReveal = useRef(true);

	useEffect(() => {
		input.current?.focus({ preventScroll: true });
	}, []);

	useEffect(() => {
		const element = activeId ? document.getElementById(activeId) : null;
		if (list.current && element) {
			reveal(list.current, element, firstReveal.current);
			firstReveal.current = false;
		}
	}, [activeId]);

	const choose = (index: number) => {
		const row = rows[index];
		if (row) {
			onPick(row.value === ANY ? null : row.value);
		}
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		const { key } = event;
		if (key === 'ArrowDown' || key === 'ArrowUp') {
			event.preventDefault();
			setActive((current) => moveActiveOption(current, rows.length, key));
		} else if (key === 'Enter' && !event.nativeEvent.isComposing) {
			event.preventDefault();
			choose(active);
		}
	};

	return (
		<>
			<div className={styles.search}>
				<svg className={styles.searchIcon} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
					<circle cx="8.5" cy="8.5" r="5.5" />
					<path d="m12.6 12.6 4.6 4.6" />
				</svg>
				<input
					ref={input}
					className={styles.searchInput}
					type="text"
					role="combobox"
					aria-label={searchLabel}
					aria-autocomplete="list"
					aria-expanded="true"
					aria-controls={listId}
					aria-activedescendant={activeId}
					autoComplete="off"
					autoCapitalize="off"
					spellCheck={false}
					enterKeyHint="done"
					placeholder={searchLabel}
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						// The best match is the one Enter takes.
						setActive(0);
						if (list.current) {
							list.current.scrollTop = 0;
						}
					}}
					onKeyDown={onKeyDown}
				/>
			</div>
			<ul
				ref={list}
				id={listId}
				className={styles.list}
				data-tree={(!searching && tree) || undefined}
				role="listbox"
				// A scrolling box is a tab stop in some browsers; focus stays on the search field.
				tabIndex={-1}
				aria-label={searchLabel}
				// Pressing an option must not take focus from the search field.
				onMouseDown={(event) => event.preventDefault()}
			>
				{rows.map((row, index) => {
					const isAny = row.value === ANY;
					const chosen = row.value === (value ?? ANY);

					return (
						<li
							key={row.value}
							id={optionId(index)}
							className={styles.option}
							role="option"
							aria-selected={chosen}
							data-active={index === active || undefined}
							data-depth={searching ? 0 : row.depth}
							style={{ '--depth': searching ? 0 : row.depth } as CSSProperties}
							onMouseMove={() => setActive(index)}
							onClick={() => choose(index)}
						>
							<svg
								className={styles.check}
								viewBox="0 0 20 20"
								aria-hidden="true"
								focusable="false"
							>
								<path d="m4.5 10.5 3.5 3.5 7.5-8" />
							</svg>
							<span className={styles.optionText}>
								<span className={styles.optionName}>{row.label}</span>
								{searching && row.trail.length > 0 && (
									<span className={styles.optionTrail}>
										<span className={popup.hidden}>, in </span>
										{row.trail.join(' › ')}
									</span>
								)}
							</span>
							{!isAny && (
								<span className={styles.optionCount}>
									{row.count.toLocaleString('en')}
									<span className={popup.hidden}> {mountainNoun(row.count)}</span>
								</span>
							)}
						</li>
					);
				})}
			</ul>
			{rows.length === 0 && (
				<p className={styles.empty} aria-hidden="true">
					{noMatchesMessage(query.trim())}
				</p>
			)}
			<span className={popup.hidden} role="status">
				{searching
					? rows.length === 0
						? noMatchesMessage(query.trim())
						: choicesFound(rows.length)
					: ''}
			</span>
		</>
	);
}
