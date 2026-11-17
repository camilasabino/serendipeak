import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
	COPIED_MESSAGE,
	COPY_FAILED_MESSAGE,
	COPY_LINK_LABEL,
	SHARED_MESSAGE,
	SHARE_LABEL,
	ShareButton,
	ShareControl,
	copyFallbackLabel,
	feedbackFor,
	shareButtonLabel,
	type ShareFeedback
} from './ShareControl';
import { anchorsOf, textsOf } from './test-support/markup';

const noop = () => {};
const URL_TO_SHARE = 'https://serendipeak.example/mountains/k2';

function render(native: boolean, feedback: ShareFeedback = { status: 'idle' }): string {
	return renderToStaticMarkup(
		<ShareButton
			title="K2"
			native={native}
			feedback={feedback}
			onShare={noop}
			onCopy={noop}
			onDismiss={noop}
		/>
	);
}

function buttonsOf(html: string): { label: string; attributes: string; tip: string }[] {
	return [...html.matchAll(/<button\s([^>]*)>(.*?)<\/button>/gs)].map((match) => ({
		attributes: match[1] ?? '',
		label: /aria-label="([^"]*)"/.exec(match[1] ?? '')?.[1] ?? '',
		tip: textsOf(match[2] ?? '', 'span').at(-1) ?? ''
	}));
}

describe('ShareButton', () => {
	it('renders native buttons that submit nothing and are named by what they do', () => {
		const html = render(true);

		expect(html).not.toContain('<a ');
		expect(anchorsOf(html)).toEqual([]);
		expect(buttonsOf(html).map(({ label }) => label)).toEqual(['Share K2', COPY_LINK_LABEL]);
		for (const { attributes } of buttonsOf(html)) {
			expect(attributes).toContain('type="button"');
		}
	});

	it('names every action without relying on its tooltip, which assistive technology skips', () => {
		const html = render(true);

		expect(
			html.match(/<span[^>]*aria-hidden="true"[^>]*>(?:Share|Copy link)<\/span>/g)
		).toHaveLength(2);
		for (const { label } of buttonsOf(html)) {
			expect(label).not.toBe('');
		}
	});

	it('keeps the two actions visually distinct with different glyphs', () => {
		const [share, copy] = [...render(true).matchAll(/<svg[\s\S]*?<\/svg>/g)].map(
			(match) => match[0]
		);

		expect(share).toBeDefined();
		expect(copy).toBeDefined();
		expect(share).not.toBe(copy);
	});

	it('groups the actions under one name', () => {
		expect(render(true)).toContain(`role="group" aria-label="${SHARE_LABEL}"`);
	});

	it('offers only Copy link when the browser cannot share natively', () => {
		expect(buttonsOf(render(false)).map(({ label }) => label)).toEqual([COPY_LINK_LABEL]);
	});

	it('keeps an empty live region mounted so the first announcement is reliable', () => {
		const html = render(false);

		expect(html).toMatch(/<span aria-live="polite" aria-atomic="true" class="[^"]*"><\/span>/);
		expect(html).not.toContain('role="group" aria-labelledby');
		expect(html).not.toContain('<input');
	});

	it('announces a copy and says it in the tooltip, with a check in place of the link', () => {
		const idle = render(false);
		const copied = render(false, { status: 'copied' });

		expect(textsOf(copied, 'span')).toContain(COPIED_MESSAGE);
		expect(copied).toMatch(/<span aria-live="polite"[^>]*>Link copied\.<\/span>/);
		expect(buttonsOf(copied)[0]?.tip).toBe(COPIED_MESSAGE);
		expect(buttonsOf(copied)[0]?.attributes).toContain('data-done');
		expect(buttonsOf(copied)[0]?.label).toBe(COPY_LINK_LABEL);
		expect(buttonsOf(idle)[0]?.attributes).not.toContain('data-done');
		expect(copied.match(/<svg[\s\S]*?<\/svg>/)?.[0]).not.toBe(
			idle.match(/<svg[\s\S]*?<\/svg>/)?.[0]
		);
	});

	it('marks only the action that ran as done', () => {
		const shared = buttonsOf(render(true, { status: 'shared' }));

		expect(shared[0]?.attributes).toContain('data-done');
		expect(shared[0]?.tip).toBe(SHARED_MESSAGE);
		expect(shared[1]?.attributes).not.toContain('data-done');
		expect(render(true, { status: 'shared' })).toMatch(/aria-live="polite"[^>]*>Link shared\.</);
	});

	it('offers the link in a named, read-only field when copying failed', () => {
		const html = render(false, { status: 'failed', url: URL_TO_SHARE });

		expect(html).toMatch(/<div role="group" aria-labelledby="([^"]+)"/);
		const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
		expect(html).toContain(`<p id="${id}"`);
		expect(textsOf(html, 'p')).toEqual([COPY_FAILED_MESSAGE]);
		const input = /<input[^>]*>/.exec(html)?.[0] ?? '';
		expect(input).toContain('readOnly');
		expect(input).toContain(`value="${URL_TO_SHARE}"`);
		expect(input).toContain(`aria-label="${copyFallbackLabel('K2')}"`);
		expect(input).toContain(`aria-describedby="${id}"`);
	});

	it('leaves the failure to the field and does not repeat it in the live region', () => {
		const html = render(false, { status: 'failed', url: URL_TO_SHARE });

		expect(html).toMatch(/<span aria-live="polite" aria-atomic="true" class="[^"]*"><\/span>/);
	});
});

describe('labels', () => {
	it('names the share action after the mountain and the field after its link', () => {
		expect(shareButtonLabel('Aoraki / Mount Cook')).toBe('Share Aoraki / Mount Cook');
		expect(copyFallbackLabel('K2')).toBe('Link to K2');
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

		expect(buttonsOf(html).map(({ label }) => label)).toEqual([COPY_LINK_LABEL]);
	});
});
