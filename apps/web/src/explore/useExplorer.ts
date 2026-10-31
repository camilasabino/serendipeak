import Router from 'next/router';
import { useEffect, useState } from 'react';
import { useMountainApi } from '../api/MountainApiContext';
import { useImagePreloader } from '../media/ImagePreloaderContext';
import { useTransitionCoordinator } from '../stage/TransitionCoordinatorContext';
import { Explorer } from './Explorer';
import { bindRouteChanges, createNavigate } from './navigate';

// One explorer per mounted control. Cancelling on cleanup rather than discarding keeps it usable
// when Strict Mode mounts the control a second time.
export function useExplorer(): Explorer {
	const api = useMountainApi();
	const coordinator = useTransitionCoordinator();
	const preloader = useImagePreloader();
	const [explorer] = useState(
		() => new Explorer({ api, coordinator, preloader, navigate: createNavigate(() => Router) })
	);

	useEffect(() => {
		const release = bindRouteChanges(Router.events, explorer.routeChangeStarted);

		return () => {
			release();
			explorer.cancel();
		};
	}, [explorer]);

	return explorer;
}
