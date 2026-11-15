import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
	COPY_FAILED_MESSAGE,
	COPY_LINK_LABEL,
	SHARE_LABEL,
	ShareButton,
	ShareControl,
	feedbackFor
} from './ShareControl';
import { textsOf } from './test-support/markup';

const noop = () => {};

describe('ShareButton', () => {
	it('is a native button that submits nothing and is named by what it does', () => {
		const html = renderToStaticMarkup(
			<ShareButton native={false} feedback={{ status: 'idle' }} onShare={noop} onCopy={noop} />
		);

		expect(html).toMatch(/<button type="button"[^>]*>Copy link<\/button>/);
		expect(html).not.toContain('<a ');
	});

	it('offers only Copy link when the browser cannot share natively', () => {
		const html = renderToStaticMarkup(
			<ShareButton native={false} feedback={{ status: 'idle' }} onShare={noop} onCopy={noop} />
		);

		expect(textsOf(html, 'button')).toEqual([COPY_LINK_LABEL]);
	});

	it('offers Share and Copy link as separate actions when it can', () => {
		const html = renderToStaticMarkup(
			<ShareButton native feedback={{ status: 'idle' }} onShare={noop} onCopy={noop} />
		);

		expect(textsOf(html, 'button')).toEqual([SHARE_LABEL, COPY_LINK_LABEL]);
	});

	it('shows no status until there is something to say', () => {
		const html = renderToStaticMarkup(
			<ShareButton native={false} feedback={{ status: 'idle' }} onShare={noop} onCopy={noop} />
		);

		expect(html).not.toContain('role="status"');
		expect(html).not.toContain('<p');
	});

	it('announces success and shows the link when copying failed', () => {
		const copied = renderToStaticMarkup(
			<ShareButton native={false} feedback={{ status: 'copied' }} onShare={noop} onCopy={noop} />
		);
		const failed = renderToStaticMarkup(
			<ShareButton
				native={false}
				feedback={{ status: 'failed', url: 'https://serendipeak.example/mountains/k2' }}
				onShare={noop}
				onCopy={noop}
			/>
		);

		expect(textsOf(copied, 'p')).toEqual(['Link copied.']);
		expect(failed).toMatch(
			/<span class="[^"]*">https:\/\/serendipeak\.example\/mountains\/k2<\/span>/
		);
		expect(textsOf(failed, 'p')).toEqual([
			`${COPY_FAILED_MESSAGE} https://serendipeak.example/mountains/k2`
		]);
	});
});

describe('feedbackFor', () => {
	it('shows nothing for a cancelled share', () => {
		expect(feedbackFor('cancelled', 'u')).toEqual({ status: 'idle' });
	});

	it('keeps the URL for a failure', () => {
		expect(feedbackFor('failed', 'u')).toEqual({ status: 'failed', url: 'u' });
		expect(feedbackFor('copied', 'u')).toEqual({ status: 'copied' });
		expect(feedbackFor('shared', 'u')).toEqual({ status: 'shared' });
	});
});

describe('ShareControl on the server', () => {
	it('renders the clipboard action, which the first client render repeats', () => {
		const html = renderToStaticMarkup(
			<ShareControl title="K2" share={{ path: '/mountains/k2', canonicalUrl: null }} />
		);

		expect(textsOf(html, 'button')).toEqual([COPY_LINK_LABEL]);
	});
});
