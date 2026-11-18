/**
 * What a row of the atlas list tells the globe as the reader points at it. A mouse or pen resting on
 * the row, or the keyboard focusing it, emphasizes its marker; leaving, blurring or following the
 * link ends that. A finger has no hover and its tap opens the page, so touch is left out: the page
 * that opens clears any emphasis anyway.
 */
export interface RowHighlightHandlers {
	onPointerEnter(event: { pointerType: string }): void;
	onPointerLeave(): void;
	onFocus(): void;
	onBlur(): void;
	onClick(): void;
}

export function rowHighlight(
	highlight: (slug: string | undefined) => void,
	slug: string
): RowHighlightHandlers {
	const emphasize = () => highlight(slug);
	const clear = () => highlight(undefined);

	return {
		onPointerEnter: ({ pointerType }) => {
			if (pointerType !== 'touch') {
				emphasize();
			}
		},
		onPointerLeave: clear,
		onFocus: emphasize,
		onBlur: clear,
		onClick: clear
	};
}
