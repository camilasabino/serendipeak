import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
	SUMMIT_MARKER_STYLE,
	fitText,
	layoutSummitPill,
	planSummitMarker,
	renderRatio,
	summitPillMaxContentWidth
} from './marker';

describe('planSummitMarker', () => {
	it('keeps the canonical summit position and carries the name and the formatted elevation', () => {
		const marker = planSummitMarker({
			slug: 'aconcagua',
			name: 'Aconcagua',
			latitude: -32.65,
			longitude: -70.01,
			elevationMeters: 6961
		});

		expect(marker).toEqual({
			latitude: -32.65,
			longitude: -70.01,
			elevationMeters: 6961,
			name: 'Aconcagua',
			elevation: '6,961 m'
		});
	});

	it('uses the shared elevation format for every elevation', () => {
		const elevation = (elevationMeters: number) =>
			planSummitMarker({ slug: 'peak', name: 'Peak', latitude: 0, longitude: 0, elevationMeters })
				.elevation;

		expect(elevation(8849)).toBe('8,849 m');
		expect(elevation(1345)).toBe('1,345 m');
		expect(elevation(999)).toBe('999 m');
	});
});

describe('summit marker style', () => {
	const tokens = readFileSync(path.join(__dirname, '../../shell/tokens.css'), 'utf8');
	const token = (name: string) =>
		new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1]?.trim().replace(/\s+/g, ' ');

	it('mirrors the colours and faces of the design tokens it cannot read', () => {
		const { colors, pill } = SUMMIT_MARKER_STYLE;

		expect(colors.basalt).toBe(token('--sp-basalt'));
		expect(colors.snow).toBe(token('--sp-snow'));
		expect(colors.copper).toBe(token('--sp-copper'));
		expect(pill.name.family).toBe(token('--sp-face-display'));
		expect(pill.elevation.family).toBe(token('--sp-face-ui'));
		expect(token('--sp-geo-plate-ring')).toContain(`snow) ${pill.ringAlpha * 100}%`);
	});
});

describe('layoutSummitPill', () => {
	const measure = (text: string, part: 'name' | 'elevation') =>
		text.length * (part === 'name' ? 10 : 7);

	it('sizes the pill from the measured text and the padding, gap and shadow room', () => {
		const { paddingLeft, paddingRight, gap, height, shadow } = SUMMIT_MARKER_STYLE.pill;
		const layout = layoutSummitPill(measure, 'Matterhorn', '4,478 m');

		expect(layout.name).toBe('Matterhorn');
		expect(layout.pillWidth).toBe(Math.ceil(paddingLeft + 100 + gap + 49 + paddingRight));
		expect(layout.imageWidth).toBe(layout.pillWidth + 2 * shadow.blur);
		expect(layout.imageHeight).toBe(height + layout.padding.top + layout.padding.bottom);
		expect(layout.nameX).toBe(layout.padding.left + paddingLeft);
		expect(layout.elevationX).toBe(layout.nameX + 100 + gap);
	});

	it('shortens a name that would not fit instead of clipping it', () => {
		const { maxContentWidth, paddingLeft, paddingRight } = SUMMIT_MARKER_STYLE.pill;
		const layout = layoutSummitPill(measure, 'A'.repeat(80), '8,849 m');

		expect(layout.name.endsWith('…')).toBe(true);
		expect(layout.pillWidth).toBeLessThanOrEqual(
			Math.ceil(maxContentWidth + paddingLeft + paddingRight)
		);
	});

	it('shortens to the width it is given, keeping the elevation whole', () => {
		const { paddingLeft, paddingRight } = SUMMIT_MARKER_STYLE.pill;
		const layout = layoutSummitPill(measure, 'Piton de la Fournaise', '2,632 m', 170);

		expect(layout.name.endsWith('…')).toBe(true);
		expect(layout.pillWidth).toBeLessThanOrEqual(Math.ceil(170 + paddingLeft + paddingRight));
		expect(layout.elevationX).toBeGreaterThan(layout.nameX);
	});
});

describe('summitPillMaxContentWidth', () => {
	const { maxContentWidth, minContentWidth, paddingLeft, paddingRight } = SUMMIT_MARKER_STYLE.pill;
	const columns = 2 * 3.75 * 16;

	it('leaves the full width wherever the control columns leave room for it', () => {
		for (const stage of [448, 624, 960, 1440]) {
			expect(summitPillMaxContentWidth(stage)).toBe(maxContentWidth);
		}
	});

	it('keeps the pill between the control columns on phone-wide stages', () => {
		for (const stage of [320, 375, 390]) {
			const pill = summitPillMaxContentWidth(stage) + paddingLeft + paddingRight;

			expect(pill).toBeLessThanOrEqual(stage - columns);
			expect(summitPillMaxContentWidth(stage)).toBeLessThan(maxContentWidth);
		}
	});

	it('grows the control columns with the root font size', () => {
		expect(summitPillMaxContentWidth(390, 20)).toBeLessThan(summitPillMaxContentWidth(390, 16));
	});

	it('never shrinks below a readable run, and ignores a stage that is not measured', () => {
		expect(summitPillMaxContentWidth(200)).toBe(minContentWidth);
		expect(summitPillMaxContentWidth(0)).toBe(maxContentWidth);
		expect(summitPillMaxContentWidth(Number.NaN)).toBe(maxContentWidth);
	});
});

describe('fitText', () => {
	const measure = (text: string) => text.length * 10;

	it('keeps text that fits and ends a longer one in an ellipsis within the width', () => {
		expect(fitText('Aconcagua', 90, measure)).toBe('Aconcagua');
		expect(fitText('Aoraki / Mount Cook', 100, measure)).toBe('Aoraki /…');
	});

	it('never splits a character and always keeps at least one', () => {
		expect(fitText('𝒜𝒜𝒜𝒜', 30, (text) => Array.from(text).length * 10)).toBe('𝒜𝒜…');
		expect(fitText('Mont Blanc', 0, measure)).toBe('M…');
	});
});

describe('renderRatio', () => {
	it('is the drawing buffer density, between one and three, and one when unknown', () => {
		expect(renderRatio({ width: 1000, clientWidth: 1000 })).toBe(1);
		expect(renderRatio({ width: 2000, clientWidth: 1000 })).toBe(2);
		expect(renderRatio({ width: 5000, clientWidth: 1000 })).toBe(3);
		expect(renderRatio({ width: 500, clientWidth: 1000 })).toBe(1);
		expect(renderRatio({ width: 1000, clientWidth: 0 })).toBe(1);
	});
});
