import { readFileSync } from 'node:fs';
import type { APIRequestContext } from '@playwright/test';
import { serendipeakDocument } from '../stub-api/serendipeak-contract.mjs';

export const STUB_API_URL = `http://127.0.0.1:${process.env.STUB_API_PORT ?? 8099}`;

const CONTRACTS = new URL('../../../../contracts/v1/', import.meta.url);

/** A vendored v1 document, as SerendiPeak serves it. */
export function fixture<T>(name: string): T {
	return serendipeakDocument(JSON.parse(readFileSync(new URL(name, CONTRACTS), 'utf8')) as T);
}

export async function resetStub(request: APIRequestContext) {
	await request.post(`${STUB_API_URL}/__control/reset`);
}

export async function useScenario(request: APIRequestContext, scenario: string) {
	await request.post(`${STUB_API_URL}/__control/scenario/${scenario}`);
}

export async function stubRequests(request: APIRequestContext): Promise<string[]> {
	const response = await request.get(`${STUB_API_URL}/__control/requests`);
	return (await response.json()) as string[];
}

const ENTITIES: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#x27;': "'",
	'&#39;': "'"
};

function decode(text: string): string {
	return text.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

export function titleOf(html: string): string | null {
	const match = /<title[^>]*>([^<]*)<\/title>/.exec(html);
	return match?.[1] === undefined ? null : decode(match[1]);
}

export function headingsOf(html: string): string[] {
	return [...html.matchAll(/<h1[^>]*>([^<]*)<\/h1>/g)].map((match) => decode(match[1] ?? ''));
}

export function hasTryAgain(html: string): boolean {
	return /<button[^>]*>\s*Try again\s*<\/button>/.test(html);
}
