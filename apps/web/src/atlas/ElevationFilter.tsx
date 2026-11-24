import { useEffect, useId, useRef, useState } from 'react';
import type { UnitSystem } from '../units/unitSystem';
import {
	CLEAR_ELEVATION_ACCESSIBLE_LABEL,
	CLEAR_ELEVATION_LABEL,
	ELEVATION_BANDS_GROUP_LABEL,
	ELEVATION_FILTER_LABEL,
	convertedBandLabel,
	displayedBandsLabel,
	elevationBandLabel,
	elevationSummary,
	retainedBandsHeading,
	retainedBandsHint
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
	/** The selected bands, when they were chosen in the other system. */
	retained: readonly ElevationOption[];
	selected: BandSelection | null;
	/** The displayed unit system, which every band ticked here is chosen in. */
	system: UnitSystem;
	onChange: (selection: BandSelection | null) => void;
}

/**
 * Elevation as a button over a popup of checkboxes, since a native select takes one value. The
 * popup stays open while bands are ticked, and Escape, a press outside or tabbing away closes it.
 */
export function ElevationFilter(props: ElevationFilterProps) {
	const { selected, system } = props;
	const [open, setOpen] = useState(false);
	const labelId = useId();
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
			<span className={controls.fieldLabel} id={labelId}>
				{ELEVATION_FILTER_LABEL}
			</span>
			<button
				ref={trigger}
				type="button"
				className={controls.trigger}
				aria-expanded={open}
				aria-controls={open ? popupId : undefined}
				aria-labelledby={`${labelId} ${summaryId}`}
				onClick={() => setOpen(!open)}
				onKeyDown={(event) => {
					if (event.key === 'ArrowDown') {
						event.preventDefault();
						setOpen(true);
					}
				}}
			>
				<span id={summaryId} className={controls.triggerValue}>
					<span className={controls.triggerText}>{elevationSummary(selected, system)}</span>
				</span>
				<svg className={controls.chevron} viewBox="0 0 24 24" aria-hidden="true">
					<path d="M6 9l6 6 6-6" />
				</svg>
			</button>
			{open && (
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
function BandList({ options, retained, selected, system, onChange }: ElevationFilterProps) {
	const box = useRef<HTMLDivElement>(null);
	const retainedId = useId();
	const hintId = useId();
	// Bands kept from the other system stay in force, but no band offered here is one of them.
	const from = selected !== null && selected.system !== system ? selected.system : undefined;
	const native = from === undefined ? (selected?.floors ?? []) : [];

	// Ticking a band of the displayed system replaces any kept from the other one.
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

	const count = selected?.floors.length ?? 0;

	return (
		<>
			{from !== undefined && (
				<div
					className={styles.retained}
					role="group"
					aria-labelledby={retainedId}
					aria-describedby={hintId}
				>
					<p id={retainedId} className={styles.retainedHeading}>
						{retainedBandsHeading(from)}
					</p>
					<p id={hintId} className={styles.hint}>
						{retainedBandsHint(system)}
					</p>
					<ul className={styles.retainedList}>
						{retained.map(({ floor, count: matching }) => (
							<li key={floor} className={styles.retainedBand}>
								<svg className={styles.tick} viewBox="0 0 16 16" aria-hidden="true">
									<path d="M3.5 8.5l3 3 6-7" />
								</svg>
								<span className={styles.label}>
									<span className={styles.retainedText}>
										<span>{elevationBandLabel(floor, from)}</span>
										<span className={styles.converted}>
											{convertedBandLabel(floor, from, system)}
										</span>
									</span>
									<MountainCount count={matching} />
								</span>
							</li>
						))}
					</ul>
				</div>
			)}
			<div
				ref={box}
				className={styles.options}
				role={from !== undefined ? 'group' : undefined}
				aria-label={from !== undefined ? displayedBandsLabel(system) : undefined}
				aria-describedby={from !== undefined ? hintId : undefined}
			>
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
