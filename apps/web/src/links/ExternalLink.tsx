import type { ComponentPropsWithoutRef } from 'react';

type ExternalLinkProps = Omit<ComponentPropsWithoutRef<'a'>, 'target' | 'rel' | 'href'> & {
	href: string;
};

export function ExternalLink({ children, ...props }: ExternalLinkProps) {
	return (
		<a {...props} target="_blank" rel="external noopener noreferrer">
			{children}
		</a>
	);
}
