import { describe, it, expect, vi } from 'vitest';
import {
	InvalidImageryModeError,
	SENTINEL2_ASSET_ID,
	createBaseLayer,
	imageryStatus,
	resolveImageryMode
} from './imagery';

describe('resolveImageryMode', () => {
	it('defaults to Sentinel-2 in development', () => {
		expect(resolveImageryMode(true)).toBe('sentinel2');
		expect(resolveImageryMode(true, '')).toBe('sentinel2');
		expect(resolveImageryMode(true, '   ')).toBe('sentinel2');
	});

	it('defaults to World Imagery in production', () => {
		expect(resolveImageryMode(false)).toBe('world');
		expect(resolveImageryMode(false, '')).toBe('world');
	});

	it.each(['sentinel2', 'world', 'none'] as const)('honors an explicit %s override', (mode) => {
		expect(resolveImageryMode(true, mode)).toBe(mode);
		expect(resolveImageryMode(false, mode)).toBe(mode);
	});

	it('trims the configured value', () => {
		expect(resolveImageryMode(true, ' world ')).toBe('world');
	});

	it.each(['bing', 'World', 'sentinel-2', 'true'])('rejects the invalid value %s', (value) => {
		expect(() => resolveImageryMode(true, value)).toThrow(InvalidImageryModeError);
		expect(() => resolveImageryMode(false, value)).toThrow(InvalidImageryModeError);
	});

	it('names the accepted values in the error', () => {
		expect(() => resolveImageryMode(true, 'bing')).toThrow(/sentinel2, world, none/);
		expect(() => resolveImageryMode(true, 'bing')).toThrow(/^NEXT_PUBLIC_CESIUM_IMAGERY_MODE /);
	});
});

describe('imageryStatus', () => {
	it('labels production imagery and notes the session cost', () => {
		expect(imageryStatus('world')).toEqual({
			label: 'Imagery: Production',
			note: 'Production imagery · reloads may consume imagery sessions'
		});
	});

	it('labels Sentinel-2 and none without a note', () => {
		expect(imageryStatus('sentinel2')).toEqual({ label: 'Imagery: Sentinel-2' });
		expect(imageryStatus('none')).toEqual({ label: 'Imagery: None' });
	});
});

describe('createBaseLayer', () => {
	function sources() {
		return {
			sentinel2: vi.fn(() => 'sentinel2-layer'),
			world: vi.fn(() => 'world-layer')
		};
	}

	it('creates only the Sentinel-2 layer in sentinel2 mode', () => {
		const available = sources();

		expect(createBaseLayer('sentinel2', available)).toBe('sentinel2-layer');
		expect(available.sentinel2).toHaveBeenCalledTimes(1);
		expect(available.world).not.toHaveBeenCalled();
	});

	it('creates only the World Imagery layer in world mode', () => {
		const available = sources();

		expect(createBaseLayer('world', available)).toBe('world-layer');
		expect(available.world).toHaveBeenCalledTimes(1);
		expect(available.sentinel2).not.toHaveBeenCalled();
	});

	it('creates no layer in none mode', () => {
		const available = sources();

		expect(createBaseLayer('none', available)).toBe(false);
		expect(available.sentinel2).not.toHaveBeenCalled();
		expect(available.world).not.toHaveBeenCalled();
	});

	it('never falls back to World Imagery when Sentinel-2 fails', () => {
		const available = sources();
		available.sentinel2.mockImplementation(() => {
			throw new Error('asset unavailable');
		});

		expect(() => createBaseLayer('sentinel2', available)).toThrow('asset unavailable');
		expect(available.world).not.toHaveBeenCalled();
	});

	it('uses the documented Sentinel-2 asset', () => {
		expect(SENTINEL2_ASSET_ID).toBe(3954);
	});
});
