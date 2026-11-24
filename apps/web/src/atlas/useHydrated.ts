import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False in server markup and in the hydration render, true afterwards. For controls that do
 * nothing without script: the document a crawler or a script-less browser receives omits them,
 * and the first client render still agrees with the server's.
 */
export function useHydrated(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => true,
		() => false
	);
}
