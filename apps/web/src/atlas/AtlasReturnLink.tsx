import Link from 'next/link';
import Router from 'next/router';
import { BACK_TO_ATLAS_LABEL } from './atlasCopy';
import { ATLAS_PATH } from './atlasQuery';
import { isPlainClick } from './AtlasReturn';
import { useAtlasReturn, useOpenedFromAtlas } from './AtlasReturnContext';

/**
 * The link from a mountain back to the atlas, offered only to a reader who opened the mountain
 * from the atlas; one who came through search, Explore, a shared link or a reload is not
 * returning to anything. It is an ordinary link to /atlas, so it works in a new tab. A plain click
 * steps back to the atlas entry rather than adding a second one above the mountain, so Back never
 * replays the trip: Atlas, Mountain, this link and Back lead to whatever preceded the atlas. The
 * router is read when clicked, so the link also renders where no router is mounted.
 */
export function AtlasReturnLink() {
	const atlasReturn = useAtlasReturn();
	const openedFromAtlas = useOpenedFromAtlas();

	if (!openedFromAtlas) {
		return null;
	}

	return (
		<Link
			href={ATLAS_PATH}
			onClick={(event) => {
				if (atlasReturn?.entryBelowIsAtlas && isPlainClick(event)) {
					event.preventDefault();
					Router.back();
				}
			}}
		>
			<span aria-hidden="true">←</span>
			{BACK_TO_ATLAS_LABEL}
		</Link>
	);
}
