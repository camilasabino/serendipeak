// One failing disposer must not strand the resources after it; the failure is logged, not thrown.
export function releaseBestEffort(
	owner: string,
	disposers: ReadonlyArray<readonly [string, () => void]>
): void {
	for (const [name, dispose] of disposers) {
		try {
			dispose();
		} catch (error) {
			console.error(`${owner} cleanup failed: ${name}`, error);
		}
	}
}
