import { describe, expect, it } from 'vitest';
import { isStructuralAspectChange, stageAspect } from './stageFrame';

describe('stage aspect', () => {
	it('uses width divided by height', () => {
		expect(stageAspect({ width: 560, height: 762 })).toBeCloseTo(560 / 762, 10);
		expect(stageAspect({ width: 895, height: 468 })).toBeCloseTo(895 / 468, 10);
	});

	it('treats a missing stage as no aspect', () => {
		expect(stageAspect({ width: 0, height: 700 })).toBe(0);
		expect(stageAspect({ width: 700, height: 0 })).toBe(0);
	});
});

describe('structural aspect change', () => {
	const narrowDesktop = stageAspect({ width: 560, height: 762 });
	const wideMobile = stageAspect({ width: 895, height: 468 });

	it('reframes across the 896 and 895 stage shapes', () => {
		expect(isStructuralAspectChange(narrowDesktop, wideMobile)).toBe(true);
		expect(isStructuralAspectChange(wideMobile, narrowDesktop)).toBe(true);
	});

	it('reframes at a 20% relative change and ignores a smaller one', () => {
		expect(isStructuralAspectChange(1.4, 1.68)).toBe(true);
		expect(isStructuralAspectChange(1.4, 1.4 * 0.8)).toBe(true);
		expect(isStructuralAspectChange(1.4, 1.5)).toBe(false);
		expect(isStructuralAspectChange(1.4, 1.4)).toBe(false);
	});

	it('reframes once a real stage replaces an unknown one', () => {
		expect(isStructuralAspectChange(0, narrowDesktop)).toBe(true);
		expect(isStructuralAspectChange(narrowDesktop, 0)).toBe(false);
	});
});
