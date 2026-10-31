import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandMark } from './BrandMark';
import styles from './SiteHeader.module.css';

export function SiteHeader({ children }: { children?: ReactNode }) {
	return (
		<header className={styles.header}>
			<Link className={styles.brand} href="/">
				<BrandMark size={36} />
				<span className={styles.name}>SerendiPeak</span>
			</Link>
			{children && <div className={styles.nav}>{children}</div>}
		</header>
	);
}
