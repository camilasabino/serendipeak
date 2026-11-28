import { useLayoutEffect, type RefObject } from 'react';

/**
 * Brings a scrolled element back to its top. Returns whether it moved, so a sheet already at the
 * top is not written to.
 */
export function scrollToTop(element: Pick<HTMLElement, 'scrollTop'> | null): boolean {
	if (!element || !(element.scrollTop > 0)) {
		return false;
	}
	element.scrollTop = 0;

	return true;
}

/**
 * Starts the details sheet from its top whenever the mountain it describes changes. The page
 * keeps one sheet element across client navigation, so on a wide stage, where the sheet scrolls on
 * its own, the next mountain would otherwise open at the last one's scroll offset, its name above
 * the visible part. A layout effect resets it before the new mountain paints. Anything that does not
 * change the mountain, a unit switch or the camera, leaves the reader where they are. A phone's
 * sheet scrolls with the page, which the router returns to the top on every navigation.
 */
export function useSheetScrollReset(sheet: RefObject<HTMLElement | null>, mountain: string): void {
	useLayoutEffect(() => {
		scrollToTop(sheet.current);
	}, [sheet, mountain]);
}
