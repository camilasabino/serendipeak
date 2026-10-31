export class MissingIonTokenError extends Error {
	constructor() {
		super(
			'NEXT_PUBLIC_CESIUM_ION_TOKEN is not set. Add a Cesium ion access token to apps/web/.env.local.'
		);
		this.name = 'MissingIonTokenError';
	}
}

export function requireIonToken(token: string | undefined): string {
	const trimmed = token?.trim();

	if (!trimmed) {
		throw new MissingIonTokenError();
	}

	return trimmed;
}
