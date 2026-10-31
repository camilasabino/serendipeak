import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/spectral/400.css';
import type { AppProps } from 'next/app';
import { AppFrame } from '../mountain-page/AppFrame';
import '../shell/tokens.css';

export default function App({ Component, pageProps }: AppProps) {
	return (
		<AppFrame pageProps={pageProps} year={new Date().getUTCFullYear()}>
			<Component {...pageProps} />
		</AppFrame>
	);
}
