import type { MountainImage } from '../api/contract';
import { ExternalLink } from '../links/ExternalLink';
import { Disclosure } from './Disclosure';
import styles from './MountainPhoto.module.css';
import { photoAlt } from './pageCopy';

const FALLBACK_RATIO = 3 / 2;

export function MountainPhoto({
	image,
	mountainName
}: {
	image: MountainImage;
	mountainName: string;
}) {
	const ratio = image.width && image.height ? image.width / image.height : FALLBACK_RATIO;
	const { attribution, license, licenseUrl, sourcePageUrl } = image;

	return (
		<figure className={styles.photo}>
			<div className={styles.frame} style={{ aspectRatio: ratio }}>
				{/* eslint-disable-next-line @next/next/no-img-element -- remote Wikimedia renditions, sized by the contract */}
				<img
					src={image.thumbnailUrl ?? image.url}
					alt={photoAlt(mountainName)}
					loading="eager"
					decoding="async"
				/>
			</div>
			<figcaption>
				<Disclosure summary="About this photo">
					<p>{attribution}</p>
					{license && (
						<p>{licenseUrl ? <ExternalLink href={licenseUrl}>{license}</ExternalLink> : license}</p>
					)}
					<p>
						Source:{' '}
						<ExternalLink href={sourcePageUrl}>View original on Wikimedia Commons</ExternalLink>
					</p>
				</Disclosure>
			</figcaption>
		</figure>
	);
}
