import Link from 'next/link';
import type { ReactNode } from 'react';
import { ABOUT_LINK_LABEL, ABOUT_PATH } from '../about/aboutCopy';
import { BrandMark } from './BrandMark';
import styles from './SiteHeader.module.css';

interface SiteHeaderProps {
	pathname?: string;
	children?: ReactNode;
}

export function SiteHeader({ pathname, children }: SiteHeaderProps) {
	return (
		<header className={styles.header}>
			<Link className={styles.brand} href="/">
				<BrandMark size={36} />
				<span className={styles.name}>SerendiPeak</span>
			</Link>
			<nav className={styles.nav} aria-label="Primary">
				<Link
					className={styles.link}
					href={ABOUT_PATH}
					aria-current={pathname === ABOUT_PATH ? 'page' : undefined}
				>
					{ABOUT_LINK_LABEL}
				</Link>
				{children}
			</nav>
		</header>
	);
}
