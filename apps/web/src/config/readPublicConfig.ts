export type PublicEnv = {
	NEXT_PUBLIC_API_BASE_URL?: string;
	NEXT_PUBLIC_CESIUM_ION_TOKEN?: string;
};

export type PublicConfig = {
	apiBaseUrl: string;
	cesiumIonToken: string | null;
};

export class InvalidPublicConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidPublicConfigError';
	}
}

// Next inlines NEXT_PUBLIC_* only for literal `process.env.NAME` reads, so callers must pass
// those reads as an object instead of handing over `process.env` itself.
export function readPublicConfig(env: PublicEnv): PublicConfig {
	return {
		apiBaseUrl: parseApiBaseUrl(env.NEXT_PUBLIC_API_BASE_URL),
		cesiumIonToken: env.NEXT_PUBLIC_CESIUM_ION_TOKEN?.trim() || null
	};
}

function parseApiBaseUrl(value: string | undefined): string {
	const trimmed = value?.trim();
	if (!trimmed) {
		throw new InvalidPublicConfigError('NEXT_PUBLIC_API_BASE_URL is required.');
	}
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new InvalidPublicConfigError(
			`NEXT_PUBLIC_API_BASE_URL is not a valid URL: "${trimmed}".`
		);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new InvalidPublicConfigError('NEXT_PUBLIC_API_BASE_URL must use http or https.');
	}
	return trimmed.replace(/\/+$/, '');
}
