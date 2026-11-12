import { documentTitle } from '../mountain-page/pageCopy';

export const ABOUT_PATH = '/about';
export const ABOUT_LINK_LABEL = 'About';

export const ABOUT_TITLE = documentTitle('About');
export const ABOUT_DESCRIPTION =
	'Discover one mountain every day, with real photography, interactive 3D terrain and curated geography, then explore the collection in the atlas.';

export const ABOUT_EYEBROW = 'About SerendiPeak';
export const ABOUT_HEADING = 'Discover one mountain every day.';
export const ABOUT_LEDE =
	'SerendiPeak features a different mountain each day, with its terrain in 3D, its geography and real photography. Between days, the atlas opens up the rest of the collection. The aim is simple: curiosity about places, geography and landscapes around the world.';
export const TODAY_ACTION_LABEL = "See today's mountain";
export const ATLAS_ACTION_LABEL = 'Explore the atlas';

export interface Feature {
	name: string;
	description: string;
}

export const TODAY_HEADING = 'What you can do today';
export const TODAY_FEATURES: readonly Feature[] = [
	{
		name: 'Today',
		description:
			'A curated mountain each day, the same one for every visitor. Not ready to wait for tomorrow? Explore another.'
	},
	{
		name: 'Atlas',
		description:
			'The current mountain collection, browsed by continent. Choose a mountain to open its full profile and 3D terrain, then return to the atlas to keep browsing.'
	},
	{
		name: 'Interactive 3D terrain',
		description: "Look at the mountain's terrain in an interactive 3D scene framed on the mountain."
	},
	{
		name: 'Real photography',
		description:
			'A real photograph for each mountain that has one, credited to its author with its license and source.'
	},
	{
		name: 'Curated descriptions and geography',
		description:
			'A short description and geographic context, such as continent, countries and region.'
	},
	{
		name: 'Locations, elevations and sources',
		description:
			'Every mountain shows its coordinates and elevation, with links to its OpenStreetMap and Wikidata records where available.'
	}
];

export const WHY_HEADING = 'Why it matters';
export const WHY_PARAGRAPHS: readonly string[] = [
	'Behind every unfamiliar name there is a real place. SerendiPeak helps you discover mountains you might not have heard of, see where they are and learn something about the geography around them.',
	'It is meant as a small daily pause for curiosity, exploration and appreciation of mountain landscapes.'
];

export const VISION_HEADING = 'Where it could go';
export const VISION_INTRO =
	'The atlas is a starting point. SerendiPeak aims to keep growing into a place to discover, locate, explore and learn about mountains around the world.';
export const VISION_NOTE_TITLE = 'Possibilities, not available today';
export const VISION_NOTE =
	'The ideas below describe a direction. None of them is a feature you can use now.';
export const VISION_IDEAS: readonly string[] = [
	'A broader and richer mountain catalog',
	'Browsing by country and mountain range',
	'Nearby mountains and geographic relationships between them',
	'More detailed mountain profiles and photographs',
	'Additional geographic, historical and environmental context',
	'Routes and tracks, as a potential later extension'
];

export const CLOSING_CUE = 'Tomorrow, another mountain.';
export const CLOSING_LINK_LABEL = "Back to today's mountain";
