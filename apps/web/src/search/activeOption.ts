export type ListKey = 'ArrowDown' | 'ArrowUp';

/** The option a key makes active, wrapping at both ends; -1 means none is active. */
export function moveActiveOption(active: number, count: number, key: ListKey): number {
	if (count === 0) {
		return -1;
	}
	if (key === 'ArrowDown') {
		return active + 1 >= count ? 0 : active + 1;
	}

	return active <= 0 ? count - 1 : active - 1;
}
