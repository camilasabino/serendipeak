import type { MountainImage } from '../api/contract';
import { ExternalLink } from '../links/ExternalLink';
import styles from './PhotoCredit.module.css';

export function PhotoCredit({
	image
}: {
	image: Pick<MountainImage, 'author' | 'sourcePageUrl' | 'license' | 'licenseUrl'>;
}) {
	const { author, sourcePageUrl, license, licenseUrl } = image;

	return (
		<>
			<span>
				Photo by{' '}
				{sourcePageUrl ? <ExternalLink href={sourcePageUrl}>{author}</ExternalLink> : author}
			</span>
			{license && (
				<>
					<span className={styles.separator} aria-hidden="true">
						·
					</span>
					<span>
						{licenseUrl ? <ExternalLink href={licenseUrl}>{license}</ExternalLink> : license}
					</span>
				</>
			)}
		</>
	);
}
