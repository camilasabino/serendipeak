import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { moveActiveOption } from '../search/activeOption';
import { SORT_LABEL, SORT_OPTION_LABELS } from './atlasCopy';
import { ATLAS_SORTS, type AtlasSort } from './atlasSort';
import controls from './AtlasControls.module.css';
import choices from './ChoiceFilter.module.css';
import { FilterPopup } from './FilterPopup';

interface SortMenuProps {
	value: AtlasSort;
	onChange: (sort: AtlasSort) => void;
}

/**
 * The sort order as a button over a short listbox, in the popup and the option rows of the
 * filters. With three options there is nothing to search, so the listbox itself holds focus and
 * names its active option through `aria-activedescendant`.
 */
export function SortMenu({ value, onChange }: SortMenuProps) {
	const [open, setOpen] = useState(false);
	const labelId = useId();
	const valueId = useId();
	const popupId = useId();
	const trigger = useRef<HTMLButtonElement>(null);

	const dismiss = (restoreFocus: boolean) => {
		setOpen(false);
		if (restoreFocus) {
			trigger.current?.focus();
		}
	};

	return (
		<div className={controls.sort}>
			<span className={controls.fieldLabel} id={labelId}>
				{SORT_LABEL}
			</span>
			<button
				ref={trigger}
				type="button"
				className={controls.trigger}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? popupId : undefined}
				aria-labelledby={`${labelId} ${valueId}`}
				onClick={() => setOpen(!open)}
				onKeyDown={(event) => {
					if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
						event.preventDefault();
						setOpen(true);
					}
				}}
			>
				<span id={valueId} className={controls.triggerValue}>
					<span className={controls.triggerText}>{SORT_OPTION_LABELS[value]}</span>
				</span>
				<svg className={controls.chevron} viewBox="0 0 24 24" aria-hidden="true">
					<path d="M6 9l6 6 6-6" />
				</svg>
			</button>
			{open && (
				<FilterPopup id={popupId} anchor={trigger} onDismiss={dismiss}>
					<SortList
						value={value}
						onPick={(sort) => {
							onChange(sort);
							dismiss(true);
						}}
					/>
				</FilterPopup>
			)}
		</div>
	);
}

// Mounted only while the popup is open, so focus enters it each time it opens.
function SortList({ value, onPick }: { value: AtlasSort; onPick: (sort: AtlasSort) => void }) {
	const id = useId();
	const list = useRef<HTMLUListElement>(null);
	const [active, setActive] = useState(Math.max(0, ATLAS_SORTS.indexOf(value)));

	useEffect(() => {
		list.current?.focus({ preventScroll: true });
	}, []);

	const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
		const { key } = event;
		if (key === 'ArrowDown' || key === 'ArrowUp') {
			event.preventDefault();
			setActive((current) => moveActiveOption(current, ATLAS_SORTS.length, key));
		} else if (key === 'Home' || key === 'End') {
			event.preventDefault();
			setActive(key === 'Home' ? 0 : ATLAS_SORTS.length - 1);
		} else if (key === 'Enter' || key === ' ') {
			event.preventDefault();
			onPick(ATLAS_SORTS[active]!);
		}
	};

	return (
		<ul
			ref={list}
			className={choices.list}
			role="listbox"
			aria-label={SORT_LABEL}
			aria-activedescendant={`${id}-${active}`}
			tabIndex={0}
			onKeyDown={onKeyDown}
		>
			{ATLAS_SORTS.map((sort, index) => (
				<li
					key={sort}
					id={`${id}-${index}`}
					className={choices.option}
					role="option"
					aria-selected={sort === value}
					data-active={index === active || undefined}
					onMouseMove={() => setActive(index)}
					// Pressing an option must not take focus from the listbox.
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => onPick(sort)}
				>
					<svg className={choices.check} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
						<path d="m4.5 10.5 3.5 3.5 7.5-8" />
					</svg>
					<span className={choices.optionText}>
						<span className={choices.optionName}>{SORT_OPTION_LABELS[sort]}</span>
					</span>
				</li>
			))}
		</ul>
	);
}
