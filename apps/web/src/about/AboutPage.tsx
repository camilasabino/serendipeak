import Head from 'next/head';
import Link from 'next/link';
import { ATLAS_PATH } from '../atlas/atlasQuery';
import { ExternalLink } from '../links/ExternalLink';
import { ContourMotif } from '../shell/ContourMotif';
import { ABOUT_CONTOURS } from '../shell/contourPatterns';
import styles from './AboutPage.module.css';
import {
	ABOUT_DESCRIPTION,
	ABOUT_EYEBROW,
	ABOUT_HEADING,
	ABOUT_LEDE_PARAGRAPHS,
	ABOUT_TITLE,
	ATLAS_ACTION_LABEL,
	BEHIND_AUTHOR,
	BEHIND_AUTHOR_URL,
	BEHIND_EYEBROW,
	BEHIND_HEADING,
	BEHIND_PARAGRAPHS,
	BEHIND_PHOTOS,
	EXPERIENCE_BLOCKS,
	EXPERIENCE_HEADING,
	LOVE_HEADING,
	LOVE_PARAGRAPHS,
	TODAY_ACTION_LABEL
} from './aboutCopy';

function BehindParagraph({ text }: { text: string }) {
	const [before, after] = text.split(BEHIND_AUTHOR);

	if (after === undefined) {
		return <p>{text}</p>;
	}

	return (
		<p>
			{before}
			<ExternalLink className={styles.author} href={BEHIND_AUTHOR_URL}>
				{BEHIND_AUTHOR}
			</ExternalLink>
			{after}
		</p>
	);
}

export function AboutPage() {
	return (
		<>
			<Head>
				<title>{ABOUT_TITLE}</title>
				<meta name="description" content={ABOUT_DESCRIPTION} />
			</Head>
			<main className={styles.page}>
				<ContourMotif pattern={ABOUT_CONTOURS} className={styles.motif} />
				<div className={styles.column}>
					<div className={styles.intro}>
						<p className={styles.eyebrow}>{ABOUT_EYEBROW}</p>
						<h1 className={styles.title}>{ABOUT_HEADING}</h1>
						{ABOUT_LEDE_PARAGRAPHS.map((paragraph) => (
							<p key={paragraph} className={styles.lede}>
								{paragraph}
							</p>
						))}
						<div className={styles.actions}>
							<Link className={styles.action} href="/">
								{TODAY_ACTION_LABEL}
							</Link>
							<Link className={`${styles.action} ${styles.secondary}`} href={ATLAS_PATH}>
								{ATLAS_ACTION_LABEL}
							</Link>
						</div>
					</div>

					<section className={styles.section} aria-labelledby="about-experience">
						<h2 id="about-experience" className={styles.heading}>
							{EXPERIENCE_HEADING}
						</h2>
						<dl className={styles.features}>
							{EXPERIENCE_BLOCKS.map(({ name, description }) => (
								<div key={name} className={styles.feature}>
									<dt>{name}</dt>
									<dd>{description}</dd>
								</div>
							))}
						</dl>
					</section>

					<section className={styles.section} aria-labelledby="about-love">
						<h2 id="about-love" className={styles.heading}>
							{LOVE_HEADING}
						</h2>
						<div className={styles.prose}>
							{LOVE_PARAGRAPHS.map((paragraph) => (
								<p key={paragraph}>{paragraph}</p>
							))}
						</div>
					</section>

					<section className={styles.behind} aria-labelledby="about-behind">
						<div className={styles.story}>
							<p className={styles.eyebrow}>{BEHIND_EYEBROW}</p>
							<h2 id="about-behind" className={styles.behindHeading}>
								{BEHIND_HEADING}
							</h2>
						</div>
						<div className={styles.behindProse}>
							{BEHIND_PARAGRAPHS.map((paragraph) => (
								<BehindParagraph key={paragraph} text={paragraph} />
							))}
						</div>
						<div className={styles.ascent}>
							{BEHIND_PHOTOS.map((photo) => (
								<figure key={photo.src} className={styles.step}>
									{/* eslint-disable-next-line @next/next/no-img-element -- static WebP derivatives with explicit srcset */}
									<img
										src={photo.src}
										srcSet={photo.srcSet}
										sizes="(min-width: 44rem) 20rem, 60vw"
										width={photo.width}
										height={photo.height}
										alt={photo.alt}
										loading="lazy"
										decoding="async"
									/>
								</figure>
							))}
						</div>
					</section>
				</div>
			</main>
		</>
	);
}
