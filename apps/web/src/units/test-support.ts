import type { UnitPreference } from './UnitPreferenceContext';
import type { UnitSystem } from './unitSystem';

/** A preference fixed to `system` for server renders, whose snapshot is otherwise always metric. */
export function fixedPreference(system: UnitSystem): UnitPreference {
	return {
		subscribe: () => () => {},
		getSnapshot: () => system,
		getServerSnapshot: () => system,
		set: () => {}
	};
}
