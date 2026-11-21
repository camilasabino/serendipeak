import { StageShell } from '../mountain-page/StageShell';
import { SceneStore } from '../stage/SceneStore';

const store = new SceneStore();

export default function QaLoader() {
	return (
		<div style={{ height: '100vh', display: 'grid' }}>
			<StageShell store={store} label="Revealing today's mountain..." />
		</div>
	);
}
