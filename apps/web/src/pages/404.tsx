import Head from 'next/head';
import { ErrorView } from '../mountain-page/ErrorView';
import { documentTitle, PAGE_NOT_FOUND } from '../mountain-page/pageCopy';

export default function NotFoundPage() {
	return (
		<>
			<Head>
				<title>{documentTitle(PAGE_NOT_FOUND.title)}</title>
			</Head>
			<ErrorView content={PAGE_NOT_FOUND} />
		</>
	);
}
