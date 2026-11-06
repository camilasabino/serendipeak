import { readFileSync } from 'node:fs';
import { serendipeakDocument } from '../../../e2e/stub-api/serendipeak-contract.mjs';

const CONTRACT_DIRECTORY = new URL('../../../../../contracts/v1/', import.meta.url);

/** A vendored v1 document, as SerendiPeak serves it. */
export function contractFixture(name: string): unknown {
	return serendipeakDocument(
		JSON.parse(readFileSync(new URL(name, CONTRACT_DIRECTORY), 'utf8')) as unknown
	);
}

export const MOUNTAIN_FIXTURES = [
	'mountain-complete.json',
	'mountain-sparse.json',
	'mountain-minimal.json'
] as const;
