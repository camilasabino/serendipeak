export const STRUCTURAL_ASPECT_DELTA = 0.2;

export interface StageSize {
	width: number;
	height: number;
}

export function stageAspect(size: StageSize): number {
	if (!(size.width > 0) || !(size.height > 0)) {
		return 0;
	}
	return size.width / size.height;
}

export function isStructuralAspectChange(previous: number, next: number): boolean {
	if (!(next > 0)) {
		return false;
	}
	if (!(previous > 0)) {
		return true;
	}
	const ratio = next / previous;
	return ratio >= 1 + STRUCTURAL_ASPECT_DELTA || ratio <= 1 / (1 + STRUCTURAL_ASPECT_DELTA);
}
