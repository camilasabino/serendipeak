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
