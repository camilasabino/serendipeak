import { useEffect, useId, useRef, useState } from 'react';
import {
	CLEAR_ELEVATION_ACCESSIBLE_LABEL,
	CLEAR_ELEVATION_LABEL,
	ELEVATION_BANDS_GROUP_LABEL,
	ELEVATION_FILTER_LABEL,
	elevationBandLabel,
	elevationSummary
} from './atlasCopy';
import { ELEVATION_BAND_METERS, normalizeBands, type ElevationOption } from './atlasFilter';
import controls from './AtlasControls.module.css';
import { FilterPopup } from './FilterPopup';
import popup from './FilterPopup.module.css';
import styles from './ElevationFilter.module.css';

interface ElevationFilterProps {
	options: readonly ElevationOption[];
	selected: readonly number[];
	onChange: (bands: number[]) => void;
}

/**
 * Elevation as a button over a popup of checkboxes, since a native select takes one value. The
 * popup stays open while bands are ticked, and Escape, a press outside or tabbing away closes it.
 */
export function ElevationFilter({ options, selected, onChange }: ElevationFilterProps) {
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
					<span className={controls.triggerText}>
						{elevationSummary(selected, ELEVATION_BAND_METERS)}
					</span>
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
					<BandList options={options} selected={selected} onChange={onChange} />
				</FilterPopup>
			)}
		</div>
	);
}

// Mounted only while the popup is open, so focus enters it each time it opens.
function BandList({ options, selected, onChange }: ElevationFilterProps) {
	const box = useRef<HTMLDivElement>(null);
	const toggle = (floor: number, checked: boolean) =>
		onChange(normalizeBands(checked ? [...selected, floor] : selected.filter((b) => b !== floor)));

	const focusFirst = () => {
		const inputs = box.current?.querySelectorAll<HTMLInputElement>('input');
		const first = box.current?.querySelector<HTMLInputElement>('input:checked') ?? inputs?.[0];
		first?.focus({ preventScroll: true });
	};

	useEffect(focusFirst, []);

	return (
		<>
			<div ref={box} className={styles.options}>
				{options.map(({ floor, count }) => (
					<label key={floor} className={styles.check}>
						<input
							type="checkbox"
							checked={selected.includes(floor)}
							onChange={(event) => toggle(floor, event.target.checked)}
						/>
						<span className={styles.label}>
							<span>{elevationBandLabel(floor, ELEVATION_BAND_METERS)}</span>
							<span className={styles.count}>
								{count.toLocaleString('en')}
								<span className={popup.hidden}> {count === 1 ? 'mountain' : 'mountains'}</span>
							</span>
						</span>
					</label>
				))}
			</div>
			<div className={styles.footer}>
				<span aria-hidden="true">
					{selected.length === 0 ? 'None selected' : `${selected.length} selected`}
				</span>
				<button
					type="button"
					className={styles.clear}
					disabled={selected.length === 0}
					aria-label={CLEAR_ELEVATION_ACCESSIBLE_LABEL}
					onClick={() => {
						onChange([]);
						focusFirst();
					}}
				>
					{CLEAR_ELEVATION_LABEL}
				</button>
			</div>
		</>
	);
}
