import Link from 'next/link';
import type { ReactNode } from 'react';
import { ABOUT_LINK_LABEL, ABOUT_PATH } from '../about/aboutCopy';
import { ATLAS_LINK_LABEL } from '../atlas/atlasCopy';
import { ATLAS_PATH } from '../atlas/atlasQuery';
import { TODAY_LINK_LABEL, TODAY_PATH } from '../mountain-page/pageCopy';
import { SearchControl } from '../search/SearchControl';
import { BrandMark } from './BrandMark';
import styles from './SiteHeader.module.css';

interface SiteHeaderProps {
	pathname?: string;
	children?: ReactNode;
}

export function SiteHeader({ pathname, children }: SiteHeaderProps) {
	return (
		<header className={styles.header}>
			<Link className={styles.brand} href={TODAY_PATH}>
				<BrandMark size={36} />
				<span className={styles.name}>SerendiPeak</span>
			</Link>
			<nav className={styles.nav} aria-label="Primary">
				<SearchControl />
				<Link
					className={styles.link}
					href={TODAY_PATH}
					aria-current={pathname === TODAY_PATH ? 'page' : undefined}
				>
					{TODAY_LINK_LABEL}
				</Link>
				<Link
					className={styles.link}
					href={ATLAS_PATH}
					aria-current={pathname === ATLAS_PATH ? 'page' : undefined}
				>
					{ATLAS_LINK_LABEL}
				</Link>
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
