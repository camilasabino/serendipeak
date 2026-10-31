export function BrandMark({ size }: { size: number }) {
	return (
		// eslint-disable-next-line @next/next/no-img-element -- pre-sized static brand asset, no optimizer needed
		<img src="/brand/serendipeak-mark.png" alt="" width={size} height={size} />
	);
}
