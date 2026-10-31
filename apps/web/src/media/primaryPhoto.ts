export function photoAlt(mountainName: string): string {
	return `Photograph of ${mountainName}`;
}

export function isPhotoHidden(failedSource: string | undefined, source: string): boolean {
	return failedSource === source;
}
