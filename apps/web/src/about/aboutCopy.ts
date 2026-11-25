import { SITE_DESCRIPTION, SITE_TAGLINE, documentTitle } from '../mountain-page/pageCopy';

export const ABOUT_PATH = '/about';
export const ABOUT_LINK_LABEL = 'About';

export const ABOUT_TITLE = documentTitle('About');
export const ABOUT_DESCRIPTION = SITE_DESCRIPTION;

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
			'Every day, SerendiPeak features a different mountain, shared by everyone. Discover somewhere new, take a closer look, or explore another whenever you feel like it.'
	},
	{
		name: 'See the landscape differently',
		description:
			'Move around the mountain in 3D to explore its shape and surroundings. Discover its elevation, location, and the landscapes that make it distinctive.'
	},
	{
		name: "A world beyond today's mountain",
		description:
			"The Atlas opens up mountains across the continents. Wander through the collection, discover unfamiliar names, and find places you'd like to know more about."
	}
];

export const LOVE_HEADING = 'For the love of mountains';
export const LOVE_PARAGRAPHS: readonly string[] = [
	'Some mountains are famous. Others are rarely heard of. Each has its own landscape, geography, and place in the world.',
	"SerendiPeak is for mountaineers, explorers, travelers, and anyone drawn to mountains. Whether you've stood on a summit or simply wondered about a distant peak, there's always somewhere new to discover."
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
