import { describe, expect, it } from 'vitest';
import type { DailyMountain, Mountain } from '../api/contract';
import { contractFixture } from '../api/test-support/contractFixtures';
import { describeFailure, pageTitle } from './pageCopy';
import type { FailureReason } from './pageModel';

const mountain = contractFixture('mountain-complete.json') as Mountain;
const daily = contractFixture('daily-mountain.json') as DailyMountain;

describe('pageTitle', () => {
	it('titles a permalink with the mountain name', () => {
		expect(pageTitle({ kind: 'mountain', mountain })).toBe(`${mountain.name} · SerendiPeak`);
	});

	it("titles the daily page with today's discovery", () => {
		expect(pageTitle({ kind: 'daily', daily })).toBe(
			`Today's discovery: ${daily.mountain.name} · SerendiPeak`
		);
	});

	it.each<[FailureReason, string]>([
		['not-found', 'Mountain not found · SerendiPeak'],
		['unreachable', "We couldn't load the mountain · SerendiPeak"],
		['no-eligible-mountains', "We couldn't load the mountain · SerendiPeak"],
		['api-error', "We couldn't load the mountain · SerendiPeak"]
	])('titles a %s failure', (reason, title) => {
		expect(pageTitle({ kind: 'error', reason })).toBe(title);
	});
});

describe('describeFailure', () => {
	it('offers no retry for a missing mountain', () => {
		expect(describeFailure('not-found').retryable).toBe(false);
	});

	it.each<FailureReason>(['unreachable', 'no-eligible-mountains', 'api-error'])(
		'offers a retry for %s',
		(reason) => {
			expect(describeFailure(reason).retryable).toBe(true);
		}
	);

	it('never exposes status codes or backend wording', () => {
		const reasons: FailureReason[] = [
			'not-found',
			'unreachable',
			'no-eligible-mountains',
			'api-error'
		];
		for (const reason of reasons) {
			const { title, message } = describeFailure(reason);
			expect(`${title} ${message}`).not.toMatch(/\b(404|502|503)\b|API|backend/i);
		}
	});
});
