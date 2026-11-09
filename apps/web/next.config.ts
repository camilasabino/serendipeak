import type { NextConfig } from 'next';
import { securityHeaderRules } from './src/config/securityHeaders';

const nextConfig: NextConfig = {
	reactStrictMode: true,
	// Lets the browser suite build and serve without touching the production build in .next.
	// Always defined, so the bundler folds the diagnostics branch away when the flag is off.
	env: { NEXT_PUBLIC_E2E_DIAGNOSTICS: process.env.NEXT_PUBLIC_E2E_DIAGNOSTICS ?? '' },
	// The development server needs eval and websockets that a production policy would block.
	async headers() {
		return process.env.NODE_ENV === 'production'
			? securityHeaderRules(process.env.NEXT_PUBLIC_API_BASE_URL)
			: [];
	},
	distDir: process.env.NEXT_DIST_DIR ?? '.next'
};

export default nextConfig;
