import Head from 'next/head';
import Link from 'next/link';
import { ATLAS_PATH } from '../atlas/atlasQuery';
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
	EXPERIENCE_BLOCKS,
	EXPERIENCE_HEADING,
	LOVE_HEADING,
	LOVE_PARAGRAPHS,
	TODAY_ACTION_LABEL
} from './aboutCopy';

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
				</div>
			</main>
		</>
	);
}
