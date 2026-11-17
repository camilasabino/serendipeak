const ENTITIES: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#x27;': "'"
};

export function decodeEntities(text: string): string {
	return text.replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity] ?? entity);
}

export function countOf(html: string, tag: string): number {
	return [...html.matchAll(new RegExp(`<${tag}[\\s>]`, 'g'))].length;
}

export function textsOf(html: string, tag: string): string[] {
	return [...html.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>(.*?)</${tag}>`, 'gs'))].map((match) =>
		decodeEntities((match[1] ?? '').replace(/<[^>]*>/g, ''))
	);
}

export interface Anchor {
	href: string;
	text: string;
	attributes: string;
}

export function anchorsOf(html: string): Anchor[] {
	return [...html.matchAll(/<a\s([^>]*)>(.*?)<\/a>/gs)].map((match) => {
		const attributes = match[1] ?? '';
		return {
			href: decodeEntities(/href="([^"]*)"/.exec(attributes)?.[1] ?? ''),
			text: decodeEntities((match[2] ?? '').replace(/<[^>]*>/g, '')),
			attributes
		};
	});
}

// A live region has to exist before it has anything to say, so an empty one is not a defect.
export function hasEmptyElement(html: string): boolean {
	const withoutGraphics = html
		.replace(/<svg[\s\S]*?<\/svg>/g, '[graphic]')
		.replace(/<(\w+)\s[^>]*aria-live="polite"[^>]*>\s*<\/\1>/g, '');

	return /<(\w+)(?:\s[^>]*)?>\s*<\/\1>/.test(withoutGraphics);
}
