import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
	reactStrictMode: true,
	// Lets the browser suite build and serve without touching the production build in .next.
	// Always defined, so the bundler folds the diagnostics branch away when the flag is off.
	env: { NEXT_PUBLIC_E2E_DIAGNOSTICS: process.env.NEXT_PUBLIC_E2E_DIAGNOSTICS ?? '' },
	distDir: process.env.NEXT_DIST_DIR ?? '.next'
};

export default nextConfig;
