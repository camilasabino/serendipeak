import Link from 'next/link';
import Router from 'next/router';
import { BACK_TO_ATLAS_LABEL } from './atlasCopy';
import { ATLAS_PATH } from './atlasQuery';
import { isPlainClick } from './AtlasReturn';
import { useAtlasReturn } from './AtlasReturnContext';

/**
 * The link from a mountain back to the atlas. It is an ordinary link to /atlas, so it works
 * without script and in a new tab. In place, when the reader came from the atlas it steps back to
 * that entry rather than adding a second one above the mountain, so Back never replays the trip:
 * Atlas, Mountain, this link and Back lead to whatever preceded the atlas. From a page opened
 * directly, or reached by any other route, it pushes the atlas as any link would. The router is
 * read when clicked, so the link also renders where no router is mounted.
 */
export function AtlasReturnLink() {
	const atlasReturn = useAtlasReturn();

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
