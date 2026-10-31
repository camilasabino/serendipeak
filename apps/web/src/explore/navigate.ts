export interface RoutePusher {
	push(url: string): Promise<boolean>;
}

export function mountainHref(slug: string): string {
	return `/mountains/${encodeURIComponent(slug)}`;
}

// Next rejects a push that a newer navigation replaced; that is supersession, not a failure.
function isCancelledNavigation(error: unknown): boolean {
	return error instanceof Error && 'cancelled' in error && error.cancelled === true;
}

// The router is read per call: Next hands components a new router object on each route change.
export function createNavigate(router: () => RoutePusher): (slug: string) => Promise<boolean> {
	return async (slug) => {
		try {
			return await router().push(mountainHref(slug));
		} catch (error) {
			if (isCancelledNavigation(error)) {
				return false;
			}
			throw error;
		}
	};
}
