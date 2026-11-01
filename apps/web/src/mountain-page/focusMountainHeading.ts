export const MOUNTAIN_HEADING_ID = 'mountain-name';

// Focus follows the new mountain only while nobody claimed it: after the user moved on to another
// control, or while a dialog holds it, it must stay where they put it.
export function focusMountainHeading(origin: HTMLElement | null, doc: Document = document): void {
	const active = doc.activeElement;
	const unclaimed = active === null || active === doc.body || active === origin;
	if (!unclaimed) {
		return;
	}

	doc.getElementById(MOUNTAIN_HEADING_ID)?.focus();
}
