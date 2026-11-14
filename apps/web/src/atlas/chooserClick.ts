/**
 * Whether a click on a chooser link is one the reader made there. A tap that opens the chooser
 * ends with the browser's own click, sent to whatever then stands under the finger; if that is a
 * link, it was never pressed. A pointer click counts only if its press began inside the chooser,
 * which the opening gesture's press, made before the chooser existed, never did. A click with no
 * pointer behind it (`detail` 0: the Enter key, or assistive technology) always counts.
 */
export function isIntentionalClick(click: { detail: number }, pressBeganInside: boolean): boolean {
	return click.detail === 0 || pressBeganInside;
}
