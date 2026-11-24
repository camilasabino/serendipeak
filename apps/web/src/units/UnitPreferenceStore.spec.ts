import { describe, expect, it, vi } from 'vitest';
import { UNIT_PREFERENCE_STORAGE_KEY, UnitPreferenceStore } from './UnitPreferenceStore';

function memoryStorage(initial: Record<string, string> = {}) {
	const data = new Map(Object.entries(initial));

	return {
		data,
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value)
	};
}

describe('UnitPreferenceStore', () => {
	it('defaults to metric with no storage, an empty one or a bad value', () => {
		expect(new UnitPreferenceStore().getSnapshot()).toBe('metric');
		expect(new UnitPreferenceStore(memoryStorage()).getSnapshot()).toBe('metric');
		expect(
			new UnitPreferenceStore(
				memoryStorage({ [UNIT_PREFERENCE_STORAGE_KEY]: 'furlongs' })
			).getSnapshot()
		).toBe('metric');
	});

	it('always serves metric to the server render, whatever storage holds', () => {
		const store = new UnitPreferenceStore(
			memoryStorage({ [UNIT_PREFERENCE_STORAGE_KEY]: 'imperial' })
		);

		expect(store.getSnapshot()).toBe('imperial');
		expect(store.getServerSnapshot()).toBe('metric');
	});

	it('switches, persists and notifies subscribers once per change', () => {
		const storage = memoryStorage();
		const store = new UnitPreferenceStore(storage);
		const listener = vi.fn();
		const unsubscribe = store.subscribe(listener);

		store.set('imperial');
		store.set('imperial');

		expect(store.getSnapshot()).toBe('imperial');
		expect(storage.data.get(UNIT_PREFERENCE_STORAGE_KEY)).toBe('imperial');
		expect(listener).toHaveBeenCalledTimes(1);

		unsubscribe();
		store.set('metric');
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('survives a reload: a new store reads what the last one wrote', () => {
		const storage = memoryStorage();
		new UnitPreferenceStore(storage).set('imperial');

		expect(new UnitPreferenceStore(storage).getSnapshot()).toBe('imperial');
	});

	it('keeps working when storage throws', () => {
		const throwing = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			}
		};
		const store = new UnitPreferenceStore(throwing);

		expect(store.getSnapshot()).toBe('metric');
		store.set('imperial');
		expect(store.getSnapshot()).toBe('imperial');
	});
});
