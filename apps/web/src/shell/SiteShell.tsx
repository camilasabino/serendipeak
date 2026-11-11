import type { ReactNode } from 'react';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import styles from './SiteShell.module.css';

interface SiteShellProps {
	layout: 'split' | 'plain';
	year: number;
	pathname?: string;
	navigation?: ReactNode;
	children: ReactNode;
}

export function SiteShell({ layout, year, pathname, navigation, children }: SiteShellProps) {
	return (
		<div className={layout === 'split' ? `${styles.shell} ${styles.split}` : styles.shell}>
			<SiteHeader pathname={pathname}>{navigation}</SiteHeader>
			{children}
			<SiteFooter year={year} />
		</div>
	);
}
