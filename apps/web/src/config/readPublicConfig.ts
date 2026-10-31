export type CesiumEnv = {
	NEXT_PUBLIC_CESIUM_ION_TOKEN?: string;
	NEXT_PUBLIC_CESIUM_IMAGERY_MODE?: string;
};

export type PublicEnv = {
	NEXT_PUBLIC_API_BASE_URL?: string;
};

export type PublicConfig = {
	apiBaseUrl: string;
};

export type CesiumConfig = {
	ionToken: string | null;
	imageryMode: string | null;
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
	return { apiBaseUrl: parseApiBaseUrl(env.NEXT_PUBLIC_API_BASE_URL) };
}

// The stage reads only these two values, so a missing or malformed API base URL cannot take the
// globe down. The imagery mode is validated where it is resolved, next to the imagery policy.
export function readCesiumConfig(env: CesiumEnv): CesiumConfig {
	return {
		ionToken: env.NEXT_PUBLIC_CESIUM_ION_TOKEN?.trim() || null,
		imageryMode: env.NEXT_PUBLIC_CESIUM_IMAGERY_MODE?.trim() || null
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
