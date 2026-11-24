import Link from 'next/link';
import { ABOUT_LINK_LABEL, ABOUT_PATH } from '../about/aboutCopy';
import { ATLAS_LINK_LABEL } from '../atlas/atlasCopy';
import { ATLAS_PATH } from '../atlas/atlasQuery';
import { TODAY_LINK_LABEL, TODAY_PATH } from '../mountain-page/pageCopy';
import { SearchControl } from '../search/SearchControl';
import { UnitSelector } from '../units/UnitSelector';
import { BrandSymbol, BrandWordmark } from './BrandLogo';
import styles from './SiteHeader.module.css';

const BRAND_LINK_LABEL = 'SerendiPeak home';

interface SiteHeaderProps {
	pathname?: string;
}

export function SiteHeader({ pathname }: SiteHeaderProps) {
	return (
		<header className={styles.header}>
			<Link className={styles.brand} href={TODAY_PATH} aria-label={BRAND_LINK_LABEL}>
				<BrandSymbol className={styles.symbol} />
				<BrandWordmark className={styles.wordmark} />
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
				<UnitSelector />
			</nav>
		</header>
	);
}
