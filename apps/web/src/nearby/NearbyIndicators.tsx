import Link from 'next/link';
import { useLayoutEffect, useRef } from 'react';
import { mountainHref } from '../explore/navigate';
import { formatElevation } from '../formatElevation';
import type { ScreenBox } from '../stage/globe/atlasMarkers';
import { rootFontPixels } from '../stage/globe/marker';
import type { SightedSummit } from '../stage/globe/summitSighting';
import { useUnitSystem } from '../units/UnitPreferenceContext';
import type { NearbyMountain } from './findNearbyMountains';
import { IndicatorLayout, type IndicatorSurface } from './IndicatorLayout';
import styles from './NearbyIndicators.module.css';
import type { SightingFeed } from './SightingFeed';

export const NEARBY_INDICATORS_LABEL = 'Nearby mountains on the stage';

/** Stage elements a mark must keep clear of carry this attribute. */
const OBSTACLE_SELECTOR = '[data-stage-obstacle]';

interface NearbyIndicatorsProps {
	mountains: readonly NearbyMountain[];
	sightings: SightingFeed;
}

/** The summits the stage follows for these mountains, in the same order. */
export function sightedSummitsOf(mountains: readonly NearbyMountain[]): SightedSummit[] {
	return mountains.map(({ slug, coordinates, elevationMeters }) => ({
		slug,
		latitude: coordinates.latitude,
		longitude: coordinates.longitude,
		elevationMeters
	}));
}

/**
 * Laid over the stage: one link for each nearby mountain, in one of three forms. While its summit
 * is in view and can be seen, a small disc stands exactly on it with its name beside it. While the
 * summit lies beyond the view, a chip sits at the edge it lies past, with an arrow turned toward it.
 * While it is in the frame but beyond the horizon or behind terrain, a chip in the summit label's style stands
 * over the column of its bearing, its arrow pointing on into the scene.
 * There is only ever one link per mountain, so a summit changing form changes its one link without
 * a second appearing or the first going away, and keyboard focus stays on it.
 *
 * React renders the links; where they stand and which show is written straight to them from each
 * sighting, so a moving camera re-renders nothing. The layer lets every pointer through except on
 * the marks, so the globe stays draggable. It is a labelled group only while it holds a mark.
 */
export function NearbyIndicators({ mountains, sightings }: NearbyIndicatorsProps) {
	const system = useUnitSystem();
	const layerRef = useRef<HTMLDivElement>(null);
	const slugs = mountains.map((mountain) => mountain.slug).join('\n');

	// A layout effect, so a list that changed never paints with the previous list's places.
	useLayoutEffect(() => {
		const layer = layerRef.current;
		if (!layer) {
			return;
		}

		const surface = domSurface(layer);
		const layout = new IndicatorLayout(slugs.split('\n'), surface);
		const unsubscribe = sightings.subscribe((reading) => layout.update(reading));
		// Labels change size with the unit, the fonts and the reader's text size.
		const observer = new ResizeObserver(() => layout.relayout());
		for (const part of surface.parts) {
			observer.observe(part);
		}
		// A mark held in place by keyboard focus moves on once focus leaves it.
		const onFocusOut = () => layout.relayout();
		layer.addEventListener('focusout', onFocusOut);

		return () => {
			layer.removeEventListener('focusout', onFocusOut);
			observer.disconnect();
			unsubscribe();
			layout.release();
		};
	}, [slugs, sightings]);

	if (mountains.length === 0) {
		return null;
	}

	return (
		<div ref={layerRef} className={styles.layer}>
			{mountains.map((mountain) => {
				const elevation = formatElevation(mountain.elevationMeters, system);

				return (
					<Link
						key={mountain.slug}
						href={mountainHref(mountain.slug)}
						prefetch={false}
						className={styles.mark}
						aria-label={`${mountain.name}, ${elevation}`}
						data-nearby-slug={mountain.slug}
					>
						<span className={styles.chip} data-part="chip">
							<svg className={styles.arrow} viewBox="0 0 16 16" aria-hidden="true" data-arrow="">
								<path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" />
							</svg>
							<span className={styles.text}>
								<span className={styles.name}>{mountain.name}</span>
								<span className={styles.elevation}>{elevation}</span>
							</span>
						</span>
						<span className={styles.summit}>
							<span className={styles.disc} />
							<span className={styles.label} data-part="label">
								<span className={styles.name}>{mountain.name}</span>
								<span className={styles.elevation}>{elevation}</span>
							</span>
						</span>
					</Link>
				);
			})}
		</div>
	);
}

interface Parts {
	mark: HTMLElement;
	chip: HTMLElement;
	label: HTMLElement;
}

function domSurface(layer: HTMLElement): IndicatorSurface & { parts: HTMLElement[] } {
	const marks = new Map<string, Parts>();
	const parts: HTMLElement[] = [];
	for (const mark of layer.querySelectorAll<HTMLElement>('[data-nearby-slug]')) {
		const part = (name: string) => mark.querySelector<HTMLElement>(`[data-part="${name}"]`)!;
		const found = { mark, chip: part('chip'), label: part('label') };
		marks.set(mark.dataset.nearbySlug!, found);
		parts.push(found.chip, found.label);
	}
	const sizeOf = (element: HTMLElement) => ({
		width: element.offsetWidth,
		height: element.offsetHeight
	});

	return {
		parts,
		sizes(slug) {
			const found = marks.get(slug);
			if (!found) {
				return undefined;
			}
			const chip = sizeOf(found.chip);
			const label = sizeOf(found.label);

			return chip.width > 0 && chip.height > 0 && label.width > 0 && label.height > 0
				? { chip, label }
				: undefined;
		},
		obstacles() {
			const origin = layer.getBoundingClientRect();
			const boxes: ScreenBox[] = [];
			for (const element of layer.parentElement?.querySelectorAll(OBSTACLE_SELECTOR) ?? []) {
				const rect = element.getBoundingClientRect();
				if (rect.width > 0 && rect.height > 0) {
					boxes.push({
						left: rect.left - origin.left,
						top: rect.top - origin.top,
						right: rect.right - origin.left,
						bottom: rect.bottom - origin.top
					});
				}
			}
			return boxes;
		},
		rootFontPixels,
		focused() {
			const active = layer.ownerDocument.activeElement;

			return active instanceof HTMLElement && layer.contains(active)
				? active.dataset.nearbySlug
				: undefined;
		},
		show(slug, position) {
			const found = marks.get(slug);
			if (!found) {
				return;
			}
			const { mark } = found;
			delete mark.dataset.hidden;
			const arrow = found.chip.querySelector<SVGElement>('[data-arrow]');
			if (position.mode === 'edge') {
				mark.style.transform = `translate(${position.left}px, ${position.top}px)`;
				mark.dataset.mode = 'edge';
				mark.dataset.edge = position.edge;
				if (arrow) {
					arrow.style.transform = `rotate(${position.angleDegrees.toFixed(1)}deg)`;
				}
				return;
			}
			if (position.mode === 'bearing') {
				mark.style.transform = `translate(${position.left}px, ${position.top}px)`;
				mark.dataset.mode = 'bearing';
				delete mark.dataset.edge;
				if (arrow) {
					// Straight up the stage: on along the bearing, beyond what can be seen.
					arrow.style.transform = 'rotate(-90deg)';
				}
				return;
			}

			mark.style.transform = `translate(${position.x}px, ${position.y}px)`;
			const { label } = position;
			found.label.style.transform = label ? `translate(${label.dx}px, ${label.dy}px)` : '';
			mark.dataset.mode = 'summit';
			mark.dataset.label = label ? 'shown' : 'none';
			delete mark.dataset.edge;
		},
		hide(slug, reason) {
			const found = marks.get(slug);
			if (found) {
				delete found.mark.dataset.mode;
				delete found.mark.dataset.edge;
				if (reason) {
					found.mark.dataset.hidden = reason;
				} else {
					delete found.mark.dataset.hidden;
				}
			}
		},
		shownCount(count) {
			// An empty group would be announced as a landmark with nothing in it.
			if (count > 0) {
				layer.setAttribute('role', 'group');
				layer.setAttribute('aria-label', NEARBY_INDICATORS_LABEL);
			} else {
				layer.removeAttribute('role');
				layer.removeAttribute('aria-label');
			}
		}
	};
}
