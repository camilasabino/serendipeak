import type { ReactNode } from 'react';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import styles from './SiteShell.module.css';

interface SiteShellProps {
	layout: 'split' | 'plain';
	year: number;
	pathname?: string;
	children: ReactNode;
}

export function SiteShell({ layout, year, pathname, children }: SiteShellProps) {
	return (
		<div className={layout === 'split' ? `${styles.shell} ${styles.split}` : styles.shell}>
			<SiteHeader pathname={pathname} />
			{children}
			<SiteFooter year={year} />
		</div>
	);
}
