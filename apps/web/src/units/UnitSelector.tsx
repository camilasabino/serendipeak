import { useSetUnitSystem, useUnitSystem } from './UnitPreferenceContext';
import styles from './UnitSelector.module.css';
import { elevationUnit, UNIT_SYSTEMS, type UnitSystem } from './unitSystem';

export const UNITS_GROUP_LABEL = 'Units';

const SYSTEM_NAMES: Record<UnitSystem, string> = {
	metric: 'Metric, meters',
	imperial: 'Imperial, feet'
};

export function UnitSelector() {
	const selected = useUnitSystem();
	const select = useSetUnitSystem();

	return (
		<div className={styles.group} role="group" aria-label={UNITS_GROUP_LABEL}>
			{UNIT_SYSTEMS.map((system) => (
				<button
					key={system}
					type="button"
					className={styles.option}
					aria-pressed={selected === system}
					aria-label={SYSTEM_NAMES[system]}
					onClick={() => select(system)}
				>
					{elevationUnit(system)}
				</button>
			))}
		</div>
	);
}
