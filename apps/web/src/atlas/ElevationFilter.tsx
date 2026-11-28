import { useEffect, useId, useRef, useState } from 'react';
import type { UnitSystem } from '../units/unitSystem';
import {
	CLEAR_ELEVATION_ACCESSIBLE_LABEL,
	CLEAR_ELEVATION_LABEL,
	ELEVATION_BANDS_GROUP_LABEL,
	ELEVATION_FILTER_LABEL,
	elevationBandLabel,
	elevationSummary
} from './atlasCopy';
import type { ElevationOption } from './atlasFilter';
import controls from './AtlasControls.module.css';
import { bandSelection, type BandSelection } from './elevationBands';
import { FilterPopup } from './FilterPopup';
import popup from './FilterPopup.module.css';
import styles from './ElevationFilter.module.css';

interface ElevationFilterProps {
	/** The bands of the displayed system. */
	options: readonly ElevationOption[];
	selected: BandSelection | null;
	/** The displayed unit system, which every band offered here is native to. */
	system: UnitSystem;
	onChange: (selection: BandSelection | null) => void;
	/** Why there is nothing to choose, when there is: the button then stays but does not open. */
	unavailable?: string;
}

/**
 * Elevation as a button over a popup of checkboxes, since a native select takes one value. The
 * popup stays open while bands are ticked, and Escape, a press outside or tabbing away closes it.
 */
export function ElevationFilter(props: ElevationFilterProps) {
	const { selected, unavailable } = props;
	const [open, setOpen] = useState(false);
	const labelId = useId();
	const hintId = useId();
	const summaryId = useId();
	const popupId = useId();
	const trigger = useRef<HTMLButtonElement>(null);

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
					{ELEVATION_FILTER_LABEL}
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
				aria-expanded={open}
				aria-controls={open ? popupId : undefined}
				aria-labelledby={`${labelId} ${summaryId}`}
				aria-describedby={unavailable ? hintId : undefined}
				aria-disabled={unavailable ? true : undefined}
				data-active={selected !== null || undefined}
				onClick={() => !unavailable && setOpen(!open)}
				onKeyDown={(event) => {
					if (unavailable) {
						return;
					}
					if (event.key === 'ArrowDown') {
						event.preventDefault();
						setOpen(true);
					}
				}}
			>
				<span id={summaryId} className={controls.triggerValue}>
					<span className={controls.triggerText}>{elevationSummary(selected)}</span>
				</span>
				<svg className={controls.chevron} viewBox="0 0 24 24" aria-hidden="true">
					<path d="M6 9l6 6 6-6" />
				</svg>
			</button>
			{open && !unavailable && (
				<FilterPopup
					id={popupId}
					anchor={trigger}
					onDismiss={dismiss}
					role="group"
					label={ELEVATION_BANDS_GROUP_LABEL}
				>
					<BandList {...props} />
				</FilterPopup>
			)}
		</div>
	);
}

function MountainCount({ count }: { count: number }) {
	return (
		<span className={styles.count}>
			{count.toLocaleString('en')}
			<span className={popup.hidden}> {count === 1 ? 'mountain' : 'mountains'}</span>
		</span>
	);
}

// Mounted only while the popup is open, so focus enters it each time it opens.
function BandList({ options, selected, system, onChange }: ElevationFilterProps) {
	const box = useRef<HTMLDivElement>(null);
	const native = selected?.floors ?? [];

	const toggle = (floor: number, checked: boolean) =>
		onChange(
			bandSelection(system, checked ? [...native, floor] : native.filter((f) => f !== floor))
		);

	const focusFirst = () => {
		const inputs = box.current?.querySelectorAll<HTMLInputElement>('input');
		const first = box.current?.querySelector<HTMLInputElement>('input:checked') ?? inputs?.[0];
		first?.focus({ preventScroll: true });
	};

	useEffect(focusFirst, []);

	const count = native.length;

	return (
		<>
			<div ref={box} className={styles.options}>
				{options.map(({ floor, count: matching }) => (
					<label key={floor} className={styles.check}>
						<input
							type="checkbox"
							checked={native.includes(floor)}
							onChange={(event) => toggle(floor, event.target.checked)}
						/>
						<span className={styles.label}>
							<span>{elevationBandLabel(floor, system)}</span>
							<MountainCount count={matching} />
						</span>
					</label>
				))}
			</div>
			<div className={styles.footer}>
				<span aria-hidden="true">{count === 0 ? 'None selected' : `${count} selected`}</span>
				<button
					type="button"
					className={styles.clear}
					disabled={count === 0}
					aria-label={CLEAR_ELEVATION_ACCESSIBLE_LABEL}
					onClick={() => {
						onChange(null);
						focusFirst();
					}}
				>
					{CLEAR_ELEVATION_LABEL}
				</button>
			</div>
		</>
	);
}
