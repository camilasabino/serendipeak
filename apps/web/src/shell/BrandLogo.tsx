export const WORDMARK_PATH = '/brand/serendipeak-wordmark.svg';
export const SYMBOL_PATH = '/brand/serendipeak-symbol.svg';

interface BrandLogoProps {
	/** The host sets the rendered height; the width follows from the intrinsic aspect ratio. */
	className?: string;
}

/**
 * Decorative: whoever places the logo supplies the accessible name. The artwork stays an external
 * static file so its approved paths are served exactly as supplied.
 */
export function BrandWordmark({ className }: BrandLogoProps) {
	return (
		// eslint-disable-next-line @next/next/no-img-element -- static SVG, intrinsic size from the artwork
		<img className={className} src={WORDMARK_PATH} width={1562} height={275} alt="" />
	);
}

export function BrandSymbol({ className }: BrandLogoProps) {
	return (
		// eslint-disable-next-line @next/next/no-img-element -- static SVG, intrinsic size from the artwork
		<img className={className} src={SYMBOL_PATH} width={880} height={753} alt="" />
	);
}
