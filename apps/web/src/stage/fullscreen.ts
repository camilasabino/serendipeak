export type FullscreenDocument = Pick<
	Document,
	| 'fullscreenEnabled'
	| 'fullscreenElement'
	| 'exitFullscreen'
	| 'addEventListener'
	| 'removeEventListener'
>;

export type FullscreenStage = Pick<Element, 'requestFullscreen'>;

export function fullscreenSupported(doc: FullscreenDocument): boolean {
	return doc.fullscreenEnabled === true;
}

export function isStageFullscreen(doc: FullscreenDocument, stage: unknown): boolean {
	return stage != null && doc.fullscreenElement === stage;
}

export function subscribeFullscreenChange(
	doc: FullscreenDocument,
	onChange: () => void
): () => void {
	doc.addEventListener('fullscreenchange', onChange);

	return () => doc.removeEventListener('fullscreenchange', onChange);
}

// Both calls reject when the browser refuses (no user activation, permissions policy, a document
// that is going away). The document stays the source of truth, so a refusal needs no recovery.
export async function toggleFullscreen(
	doc: FullscreenDocument,
	stage: FullscreenStage
): Promise<void> {
	try {
		if (isStageFullscreen(doc, stage)) {
			await doc.exitFullscreen();
		} else {
			await stage.requestFullscreen();
		}
	} catch {
		// Nothing to undo: no local state was changed.
	}
}
