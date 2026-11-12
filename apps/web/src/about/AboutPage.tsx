import Head from 'next/head';
import Link from 'next/link';
import { ATLAS_PATH } from '../atlas/atlasQuery';
import { TopographicMotif } from '../mountain-page/TopographicMotif';
import styles from './AboutPage.module.css';
import {
	ABOUT_DESCRIPTION,
	ATLAS_ACTION_LABEL,
	ABOUT_EYEBROW,
	ABOUT_HEADING,
	ABOUT_LEDE,
	ABOUT_TITLE,
	CLOSING_CUE,
	CLOSING_LINK_LABEL,
	TODAY_ACTION_LABEL,
	TODAY_FEATURES,
	TODAY_HEADING,
	VISION_HEADING,
	VISION_IDEAS,
	VISION_INTRO,
	VISION_NOTE,
	VISION_NOTE_TITLE,
	WHY_HEADING,
	WHY_PARAGRAPHS
} from './aboutCopy';

export function AboutPage() {
	return (
		<>
			<Head>
				<title>{ABOUT_TITLE}</title>
				<meta name="description" content={ABOUT_DESCRIPTION} />
			</Head>
			<main className={styles.page}>
				<TopographicMotif className={styles.motif} />
				<div className={styles.column}>
					<div className={styles.intro}>
						<p className={styles.eyebrow}>{ABOUT_EYEBROW}</p>
						<h1 className={styles.title}>{ABOUT_HEADING}</h1>
						<p className={styles.lede}>{ABOUT_LEDE}</p>
						<div className={styles.actions}>
							<Link className={styles.action} href="/">
								{TODAY_ACTION_LABEL}
							</Link>
							<Link className={`${styles.action} ${styles.secondary}`} href={ATLAS_PATH}>
								{ATLAS_ACTION_LABEL}
							</Link>
						</div>
					</div>

					<section className={styles.section} aria-labelledby="about-today">
						<h2 id="about-today" className={styles.heading}>
							{TODAY_HEADING}
						</h2>
						<dl className={styles.features}>
							{TODAY_FEATURES.map(({ name, description }) => (
								<div key={name} className={styles.feature}>
									<dt>{name}</dt>
									<dd>{description}</dd>
								</div>
							))}
						</dl>
					</section>

					<section className={styles.section} aria-labelledby="about-why">
						<h2 id="about-why" className={styles.heading}>
							{WHY_HEADING}
						</h2>
						<div className={styles.prose}>
							{WHY_PARAGRAPHS.map((paragraph) => (
								<p key={paragraph}>{paragraph}</p>
							))}
						</div>
					</section>

					<section className={styles.section} aria-labelledby="about-vision">
						<h2 id="about-vision" className={styles.heading}>
							{VISION_HEADING}
						</h2>
						<div className={styles.prose}>
							<p>{VISION_INTRO}</p>
							<div className={styles.ideas}>
								<p className={styles.ideasTitle}>{VISION_NOTE_TITLE}</p>
								<p className={styles.ideasNote}>{VISION_NOTE}</p>
								<ul>
									{VISION_IDEAS.map((idea) => (
										<li key={idea}>{idea}</li>
									))}
								</ul>
							</div>
						</div>
					</section>

					<p className={styles.closing}>
						<span className={styles.cue}>{CLOSING_CUE}</span>
						<Link href="/">{CLOSING_LINK_LABEL}</Link>
					</p>
				</div>
			</main>
		</>
	);
}
