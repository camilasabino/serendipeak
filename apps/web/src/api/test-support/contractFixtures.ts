import { readFileSync } from 'node:fs';

const CONTRACT_DIRECTORY = new URL('../../../../../contracts/v1/', import.meta.url);

export function contractFixture(name: string): unknown {
	return JSON.parse(readFileSync(new URL(name, CONTRACT_DIRECTORY), 'utf8'));
}

export const MOUNTAIN_FIXTURES = [
	'mountain-complete.json',
	'mountain-sparse.json',
	'mountain-minimal.json'
] as const;
