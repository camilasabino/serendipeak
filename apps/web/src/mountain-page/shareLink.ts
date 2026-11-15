/** Where a mountain's permanent address can be read from. */
export interface MountainShare {
	/** The permanent path, used when the site origin is not configured. */
	path: string;
	/** The absolute canonical URL, absent when the site origin is not configured. */
	canonicalUrl: string | null;
}

// The canonical wins; without a configured origin the origin the visitor is on is the best
// available one. The path is always the mountain's own, never the current location.
export function resolveShareUrl(share: MountainShare, currentOrigin: string): string {
	return share.canonicalUrl ?? new URL(share.path, currentOrigin).href;
}

export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'failed';

export interface ShareTarget {
	title: string;
	url: string;
}

/** The browser's sharing and clipboard abilities, each absent when the browser lacks it. */
export interface ShareEnvironment {
	share?: (data: { title: string; url: string }) => Promise<void>;
	writeText?: (text: string) => Promise<void>;
}

export function readShareEnvironment(nav: Navigator): ShareEnvironment {
	return {
		share: typeof nav.share === 'function' ? (data) => nav.share(data) : undefined,
		writeText:
			typeof nav.clipboard?.writeText === 'function'
				? (text) => nav.clipboard.writeText(text)
				: undefined
	};
}

function isCancellation(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

export async function copyLink(url: string, environment: ShareEnvironment): Promise<ShareOutcome> {
	if (!environment.writeText) {
		return 'failed';
	}

	try {
		await environment.writeText(url);
		return 'copied';
	} catch {
		return 'failed';
	}
}

// Dismissing the native sheet rejects with AbortError, which is the visitor's choice and not a
// failure. Any other native error (no user activation, an unsupported payload) falls back to the
// clipboard so the action still ends in a usable link.
export async function shareLink(
	target: ShareTarget,
	environment: ShareEnvironment
): Promise<ShareOutcome> {
	if (!environment.share) {
		return copyLink(target.url, environment);
	}

	try {
		await environment.share({ title: target.title, url: target.url });
		return 'shared';
	} catch (error) {
		return isCancellation(error) ? 'cancelled' : copyLink(target.url, environment);
	}
}
