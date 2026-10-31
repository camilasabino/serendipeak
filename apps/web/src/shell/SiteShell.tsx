import type { ReactNode } from 'react';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import styles from './SiteShell.module.css';

interface SiteShellProps {
	layout: 'split' | 'plain';
	year: number;
	navigation?: ReactNode;
	children: ReactNode;
}

export function SiteShell({ layout, year, navigation, children }: SiteShellProps) {
	return (
		<div className={layout === 'split' ? `${styles.shell} ${styles.split}` : styles.shell}>
			<SiteHeader>{navigation}</SiteHeader>
			{children}
			<SiteFooter year={year} />
		</div>
	);
}
