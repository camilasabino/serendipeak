// Throwaway Cesium bundling spike. It imports `cesium` outside src/stage/globe/cesium/ on purpose
// and is removed when CesiumGlobeScene lands. Builds without CESIUM_SPIKE=1 serve a 404 here.
import Head from 'next/head';
import { useEffect, useRef, useState } from 'react';

const CESIUM_BASE_URL = '/cesium/';

type SpikeState = 'loading' | 'ready' | 'error';

export function getStaticProps() {
	if (process.env.CESIUM_SPIKE !== '1') {
		return { notFound: true };
	}
	return { props: {} };
}

export default function CesiumSpikePage() {
	const container = useRef<HTMLDivElement>(null);
	const [state, setState] = useState<SpikeState>('loading');
	const [detail, setDetail] = useState('');

	useEffect(() => {
		let disposed = false;
		let destroy: (() => void) | undefined;

		(window as Window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = CESIUM_BASE_URL;

		import('cesium')
			.then((Cesium) => {
				if (disposed || !container.current) {
					return;
				}

				const viewer = new Cesium.Viewer(container.current, {
					baseLayer: false,
					baseLayerPicker: false,
					geocoder: false,
					animation: false,
					timeline: false,
					requestRenderMode: false
				});
				destroy = () => viewer.destroy();

				viewer.scene.renderError.addEventListener((_scene, error) => {
					setState('error');
					setDetail(String(error));
				});

				// Forces asynchronous geometry creation, which only runs inside the copied Workers.
				viewer.entities.add({
					position: Cesium.Cartesian3.fromDegrees(86.925, 27.988, 4000),
					ellipsoid: { radii: new Cesium.Cartesian3(200000, 200000, 200000) }
				});

				const removeListener = viewer.scene.globe.tileLoadProgressEvent.addEventListener(
					(pending: number) => {
						if (pending === 0 && viewer.scene.globe.tilesLoaded) {
							removeListener();
							setDetail(Cesium.buildModuleUrl('Workers/'));
							setState((current) => (current === 'error' ? current : 'ready'));
						}
					}
				);
			})
			.catch((error: unknown) => {
				if (!disposed) {
					setState('error');
					setDetail(String(error));
				}
			});

		return () => {
			disposed = true;
			destroy?.();
		};
	}, []);

	return (
		<>
			<Head>
				<link rel="stylesheet" href={`${CESIUM_BASE_URL}Widgets/widgets.css`} />
			</Head>
			<p data-testid="cesium-spike-state" data-state={state}>
				{state} {detail}
			</p>
			<div ref={container} style={{ width: 640, height: 480 }} />
		</>
	);
}
