import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MountainIndexEntry } from '../api/contract';
import { useUnitSystem } from '../units/UnitPreferenceContext';
import {
	ACTIVE_FILTERS_LABEL,
	ANY_COUNTRY_LABEL,
	ANY_RANGE_LABEL,
	COUNTRY_FILTER_LABEL,
	FILTER_LABEL,
	NO_COUNTRIES_ALTERNATIVE,
	NO_ELEVATION_ALTERNATIVE,
	NO_RANGES_ALTERNATIVE,
	RANGE_FILTER_LABEL,
	RESET_ACCESSIBLE_LABEL,
	RESET_LABEL,
	ELEVATION_CLEARED_BY_UNITS_NOTICE,
	SEARCH_COUNTRIES_LABEL,
	SEARCH_RANGES_LABEL,
	filterToggleLabel,
	noCountriesMessage,
	noRangesMessage,
	removeFilterLabel,
	resultCount
} from './atlasCopy';
import { activeFilterSummaries, filterAlternatives } from './activeFilters';
import { activeFilterCount, type AtlasFilters } from './atlasFilter';
import styles from './AtlasControls.module.css';
import { ChoiceFilter } from './ChoiceFilter';
import type { ChoiceOption } from './choiceSearch';
import { ElevationFilter } from './ElevationFilter';
import { SortMenu } from './SortMenu';
import type { AtlasBrowse } from './AtlasViewContext';
import { scopeOf, type AtlasViewStore } from './AtlasViewStore';
import type { AtlasChoice } from './useAtlasChoice';

interface AtlasControlsProps {
	browse: AtlasBrowse;
	store: AtlasViewStore;
	/** The whole catalog, which the count of matches is read against. */
	mountains: readonly MountainIndexEntry[];
	choice: AtlasChoice;
}

/**
 * Filter and sort for the atlas list, on native controls so keyboard, touch and assistive
 * technology work as the platform defines. The filters sit in a collapsible group to keep the
 * panel's room for the list; the count of matches is a polite live region, so each change is
 * announced without moving focus. What is selected stays in view as one chip per filter, which
 * the reader can remove there; the chips and the buttons both read the view, so neither keeps
 * a selection of its own. A filter with nothing to choose between is not offered while it is off.
 */
export function AtlasControls({ browse, store, mountains, choice }: AtlasControlsProps) {
	const { notice, choose, say } = choice;
	const total = mountains.length;
	const { options, view, isDefault, matches } = browse;
	const { country, elevationBands, range } = view.filters;
	// The range being browsed says how many mountains it holds, so the count is only announced.
	const countIsAnnounced = range !== null || view.continent !== null;
	const system = useUnitSystem();
	const active = activeFilterCount(view.filters);
	const [open, setOpen] = useState(false);
	const panelId = useId();
	const summaries = useMemo(() => activeFilterSummaries(view.filters, options), [view, options]);
	const alternatives = useMemo(
		() => filterAlternatives(mountains, view.filters, scopeOf(view), options),
		[mountains, view, options]
	);
	// Choosing is only pointless while the filter is off: a selection can always be let go.
	const unavailable = (offered: boolean, selected: boolean, hint: string) =>
		offered || selected ? undefined : hint;
	const toggle = useRef<HTMLButtonElement>(null);

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

	useEffect(
		() => store.subscribeToUnitClears(() => say(ELEVATION_CLEARED_BY_UNITS_NOTICE)),
		[store, say]
	);

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
					data-active={active > 0 || undefined}
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

			{summaries.length > 0 && (
				<ul className={styles.chips} aria-label={ACTIVE_FILTERS_LABEL}>
					{summaries.map(({ key, filter, value }) => (
						<li key={key}>
							<button
								type="button"
								className={styles.chip}
								aria-label={removeFilterLabel(filter, value)}
								onClick={() => {
									choose({ [key]: null } as Partial<AtlasFilters>);
									// The chip leaves with the filter it removes; focus stays on the controls.
									toggle.current?.focus();
								}}
							>
								<span className={styles.chipValue}>{value}</span>
								<svg className={styles.remove} viewBox="0 0 24 24" aria-hidden="true">
									<path d="M7 7l10 10M17 7L7 17" />
								</svg>
							</button>
						</li>
					))}
				</ul>
			)}

			<div id={panelId} className={styles.panel} hidden={!open}>
				<ChoiceFilter
					label={COUNTRY_FILTER_LABEL}
					searchLabel={SEARCH_COUNTRIES_LABEL}
					anyLabel={ANY_COUNTRY_LABEL}
					options={countries}
					value={country}
					onChange={(value) => choose({ country: value })}
					noMatchesMessage={noCountriesMessage}
					unavailable={unavailable(
						alternatives.country,
						country !== null,
						NO_COUNTRIES_ALTERNATIVE
					)}
				/>
				<ElevationFilter
					options={options.elevationBands}
					selected={elevationBands}
					system={system}
					onChange={(bands) => choose({ elevationBands: bands })}
					unavailable={unavailable(
						alternatives.elevationBands,
						elevationBands !== null,
						NO_ELEVATION_ALTERNATIVE
					)}
				/>
				<ChoiceFilter
					label={RANGE_FILTER_LABEL}
					searchLabel={SEARCH_RANGES_LABEL}
					anyLabel={ANY_RANGE_LABEL}
					options={ranges}
					value={range}
					onChange={(value) => choose({ range: value })}
					noMatchesMessage={noRangesMessage}
					unavailable={unavailable(alternatives.range, range !== null, NO_RANGES_ALTERNATIVE)}
				/>
			</div>

			<div className={styles.status}>
				<p
					className={countIsAnnounced ? `${styles.count} ${styles.announced}` : styles.count}
					aria-live="polite"
					aria-atomic="true"
				>
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
							say('');
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
