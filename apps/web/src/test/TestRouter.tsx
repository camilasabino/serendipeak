import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import type { ReactNode } from 'react';

// Pages Router components read the router from this context; a static render has none of its own.
export function TestRouter({
	pathname,
	query = {},
	children
}: {
	pathname: string;
	query?: NextRouter['query'];
	children: ReactNode;
}) {
	const search = new URLSearchParams(query as Record<string, string>).toString();
	const router = {
		pathname,
		route: pathname,
		query,
		asPath: search ? `${pathname}?${search}` : pathname,
		basePath: '',
		isReady: true,
		isFallback: false,
		isPreview: false,
		isLocaleDomain: false,
		push: async () => true,
		replace: async () => true,
		reload: () => {},
		back: () => {},
		forward: () => {},
		prefetch: async () => {},
		beforePopState: () => {},
		events: { on: () => {}, off: () => {}, emit: () => {} }
	} satisfies NextRouter;

	return <RouterContext.Provider value={router}>{children}</RouterContext.Provider>;
}
