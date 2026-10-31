export function TopographicMotif({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 1200 800"
			preserveAspectRatio="xMidYMid slice"
			aria-hidden="true"
		>
			<g fill="none" stroke="currentColor" strokeWidth="1">
				<path d="M0 140 H1200 M0 300 H1200 M0 460 H1200 M0 620 H1200" />
				<path d="M180 0 V800 M420 0 V800 M660 0 V800 M900 0 V800 M1140 0 V800" />
				<path d="M40 700 C240 560 400 620 580 460 C760 300 900 360 1180 140" />
			</g>
		</svg>
	);
}
