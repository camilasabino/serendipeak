import { SITE_TAGLINE } from '../mountain-page/pageCopy';

export const ABOUT_PATH = '/about';
export const ABOUT_LINK_LABEL = 'About';

export const ABOUT_TITLE = 'About SerendiPeak — Our Story';
export const ABOUT_DESCRIPTION =
	'SerendiPeak is a personal project for discovering mountains, built by Camila Sabino: real photography, interactive 3D terrain and a new peak every day.';

export const ABOUT_EYEBROW = 'About SerendiPeak';
export const ABOUT_HEADING = SITE_TAGLINE;
export const ABOUT_LEDE_PARAGRAPHS: readonly string[] = [
	"From familiar summits to places you've never heard of, there's a whole world of mountains to discover.",
	'SerendiPeak brings a different mountain into focus every day. Explore its landscape in 3D, see real photographs, and discover where it rises. Then follow your curiosity to mountains across the globe.'
];
export const TODAY_ACTION_LABEL = "See today's mountain";
export const ATLAS_ACTION_LABEL = 'Explore the atlas';

export interface Feature {
	name: string;
	description: string;
}

export const EXPERIENCE_HEADING = 'Discover. Explore. Wander.';
export const EXPERIENCE_BLOCKS: readonly Feature[] = [
	{
		name: 'One mountain each day',
		description:
			'Every day, SerendiPeak features a different mountain, the same one for everyone. Spend a moment with it, or travel to another whenever you feel like it.'
	},
	{
		name: 'See the landscape differently',
		description:
			'Start from a viewpoint chosen for each mountain, move around its terrain in 3D, then circle the summit in a full 360° orbit.'
	},
	{
		name: "A world beyond today's mountain",
		description:
			"The Atlas puts the whole collection on a single globe. Browse by country, mountain range, or elevation, or search for a name, and find your way to peaks you didn't know existed."
	}
];

export const LOVE_HEADING = 'For the love of mountains';
export const LOVE_PARAGRAPHS: readonly string[] = [
	'Some mountains are famous. Others are rarely heard of. Each has its own landscape, geography, and place in the world.',
	"SerendiPeak is for mountaineers, explorers, travelers, and anyone drawn to mountains. Whether you've stood on a summit or simply wondered about a distant peak, there's always another mountain worth a closer look."
];

export const BEHIND_EYEBROW = 'Behind SerendiPeak';
export const BEHIND_HEADING = 'Where two passions meet.';
export const BEHIND_AUTHOR = 'Camila Sabino';
export const BEHIND_AUTHOR_URL = 'https://camilasabino.dev/';
export const BEHIND_PARAGRAPHS: readonly string[] = [
	`I'm ${BEHIND_AUTHOR}, a software engineer, mountaineer, and trail runner, currently studying to become a mountain guide. The mountains have become an important part of my life and the way I see the world.`,
	"For me, being in the mountains is about more than reaching a summit. It's about discovering new places, embracing challenges, learning to be patient, and finding a different perspective along the way. Every mountain has something to teach, and every journey leaves something behind.",
	"SerendiPeak brings together two things I love: building with technology and exploring the mountains. I created it as a way to share that curiosity and invite others to discover the landscapes, geography, and stories behind the world's peaks."
];

export interface BehindPhoto {
	src: string;
	srcSet: string;
	width: number;
	height: number;
	alt: string;
}

function behindPhoto(name: string, alt: string): BehindPhoto {
	const widths = [360, 540, 720, 1080];

	return {
		src: `/about/${name}-540.webp`,
		srcSet: widths.map((w) => `/about/${name}-${w}.webp ${w}w`).join(', '),
		width: 540,
		height: 720,
		alt
	};
}

export const BEHIND_PHOTOS: readonly BehindPhoto[] = [
	behindPhoto(
		'camila-glacier-trail',
		'Camila smiling in a green fleece and orange cap, standing on rocky ground below a wall of glacier ice.'
	),
	behindPhoto(
		'camila-high-camp-sunset',
		'Camila in a blue down jacket and orange beanie, sitting on a rock at high camp and looking out over a valley under a pink sunset sky.'
	),
	behindPhoto(
		'camila-aconcagua-summit',
		'Camila in a turquoise jacket and blue helmet on the summit of Aconcagua, next to the summit sign and a pole hung with prayer flags.'
	)
];
