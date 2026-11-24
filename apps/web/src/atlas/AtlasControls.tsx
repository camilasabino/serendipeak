import { useId, useMemo, useRef, useState } from 'react';
import type { MountainIndexEntry } from '../api/contract';
import {
	ANY_COUNTRY_LABEL,
	ANY_RANGE_LABEL,
	COUNTRY_FILTER_LABEL,
	FILTER_LABEL,
	RANGE_FILTER_LABEL,
	RESET_ACCESSIBLE_LABEL,
	RESET_LABEL,
	SEARCH_COUNTRIES_LABEL,
	SEARCH_RANGES_LABEL,
	autoResetNotice,
	filterToggleLabel,
	noCountriesMessage,
	noRangesMessage,
	resultCount
} from './atlasCopy';
import { activeFilterCount, settleFilters, type AtlasFilters } from './atlasFilter';
import styles from './AtlasControls.module.css';
import { ChoiceFilter } from './ChoiceFilter';
import type { ChoiceOption } from './choiceSearch';
import { ElevationFilter } from './ElevationFilter';
import { SortMenu } from './SortMenu';
import type { AtlasBrowse } from './AtlasViewContext';
import type { AtlasViewStore } from './AtlasViewStore';

interface AtlasControlsProps {
	browse: AtlasBrowse;
	store: AtlasViewStore;
	/** The whole catalog, which the count of matches is read against and choices are settled on. */
	mountains: readonly MountainIndexEntry[];
}

/**
 * Filter and sort for the atlas list, on native controls so keyboard, touch and assistive
 * technology work as the platform defines. The filters sit in a collapsible group to keep the
 * panel's room for the list; the count of matches is a polite live region, so each change is
 * announced without moving focus.
 */
export function AtlasControls({ browse, store, mountains }: AtlasControlsProps) {
	const total = mountains.length;
	const { options, view, isDefault, matches } = browse;
	const { country, elevationBands, range } = view.filters;
	const active = activeFilterCount(view.filters);
	const [open, setOpen] = useState(false);
	const panelId = useId();
	const toggle = useRef<HTMLButtonElement>(null);
	// Said with the count, in the same live region, so a choice and what it undid are one announcement.
	const [notice, setNotice] = useState('');

	const countries = useMemo<ChoiceOption[]>(
		() =>
			options.countries.map(({ code, name, count }) => ({
				value: code,
				label: name,
				count,
				depth: 0,
				trail: []
			})),
		[options.countries]
	);
	const ranges = useMemo<ChoiceOption[]>(
		() =>
			options.ranges.map(({ slug, name, depth, ancestors, count }) => ({
				value: slug,
				label: name,
				count,
				depth,
				trail: ancestors
			})),
		[options.ranges]
	);

	// A choice is always kept; only the selections it leaves without mountains go back to "all".
	const choose = (change: Partial<AtlasFilters>) => {
		const [key] = Object.keys(change) as (keyof AtlasFilters)[];
		const { filters, reset, removedBands } = settleFilters(
			mountains,
			{ ...view.filters, ...change },
			key!
		);
		store.setFilters(filters);
		setNotice(autoResetNotice(reset, removedBands));
	};

	return (
		<div className={styles.controls}>
			<div className={styles.bar}>
				<button
					ref={toggle}
					type="button"
					className={styles.toggle}
					aria-expanded={open}
					aria-controls={panelId}
					aria-label={filterToggleLabel(active)}
					onClick={() => setOpen(!open)}
				>
					<span>{FILTER_LABEL}</span>
					{active > 0 && (
						<span className={styles.badge} aria-hidden="true">
							{active}
						</span>
					)}
					<svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true">
						<path d="M6 9l6 6 6-6" />
					</svg>
				</button>
				<SortMenu value={view.sort} onChange={(sort) => store.setSort(sort)} />
			</div>

			<div id={panelId} className={styles.panel} hidden={!open}>
				<ChoiceFilter
					label={COUNTRY_FILTER_LABEL}
					searchLabel={SEARCH_COUNTRIES_LABEL}
					anyLabel={ANY_COUNTRY_LABEL}
					options={countries}
					value={country}
					onChange={(value) => choose({ country: value })}
					noMatchesMessage={noCountriesMessage}
				/>
				<ElevationFilter
					options={options.elevationBands}
					selected={elevationBands}
					onChange={(bands) => choose({ elevationBands: bands })}
				/>
				<ChoiceFilter
					label={RANGE_FILTER_LABEL}
					searchLabel={SEARCH_RANGES_LABEL}
					anyLabel={ANY_RANGE_LABEL}
					options={ranges}
					value={range}
					onChange={(value) => choose({ range: value })}
					noMatchesMessage={noRangesMessage}
				/>
			</div>

			<div className={styles.status}>
				<p className={styles.count} aria-live="polite" aria-atomic="true">
					{notice
						? `${resultCount(matches.length, total)}. ${notice}`
						: resultCount(matches.length, total)}
				</p>
				{!isDefault && (
					<button
						type="button"
						className={styles.reset}
						aria-label={RESET_ACCESSIBLE_LABEL}
						onClick={() => {
							store.reset();
							setNotice('');
							// The button leaves with the view it resets; focus stays on the controls.
							toggle.current?.focus();
						}}
					>
						{RESET_LABEL}
					</button>
				)}
			</div>
		</div>
	);
}
