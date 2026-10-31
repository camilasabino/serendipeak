import type { Mountain } from '../api/contract';

export function MountainView({ mountain }: { mountain: Mountain }) {
	return (
		<main>
			<h1>{mountain.name}</h1>
		</main>
	);
}
