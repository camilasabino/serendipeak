import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseReport, summarize } from './playwright-summary.mjs';

function report(shard, specs, total = 2) {
	return {
		config: { shard: { current: shard, total } },
		stats: { duration: 5000 },
		suites: [
			{
				title: 'stage.spec.ts',
				file: 'stage.spec.ts',
				specs: [],
				suites: [
					{
						title: '@webgl static stage',
						file: 'stage.spec.ts',
						specs: specs.map(([title, duration, status = 'expected']) => ({
							title,
							file: 'stage.spec.ts',
							tests: [{ status, results: [{ duration }] }]
						}))
					}
				]
			}
		]
	};
}

function parsed(mode, shard, specs, total) {
	return parseReport(`webgl-${mode}-${shard}.json`, report(shard, specs, total));
}

const complete = () => [
	parsed('development', 1, [['one', 1000]]),
	parsed('development', 2, [['two', 3000]]),
	parsed('production', 1, [['one', 2000]]),
	parsed('production', 2, [['two', 4000]])
];

test('builds test identities from the spec file and its describe titles', () => {
	const [development] = complete();

	assert.equal(development.mode, 'development');
	assert.equal(development.shard, 1);
	assert.equal(development.total, 2);
	assert.equal(development.tests[0].id, 'stage.spec.ts › @webgl static stage › one');
});

test('a complete, disjoint and symmetric run has no coverage problems', () => {
	assert.deepEqual(summarize(complete()).problems, []);
});

test('reports shard imbalance and the slowest test', () => {
	const { markdown } = summarize(complete());

	assert.match(markdown, /\| development \| 2 \| 0\.1 min \| 0\.1 min \| 0\.0 min \| 67% \|/);
	assert.match(
		markdown,
		/\| 4\.0s \| production \| stage\.spec\.ts › @webgl static stage › two \|/
	);
});

test('a test that ran in two shards of one mode is a problem', () => {
	const reports = complete();

	reports[1] = parsed('development', 2, [
		['one', 1000],
		['two', 3000]
	]);

	assert.match(summarize(reports).problems.join('\n'), /development: .* ran more than once/);
});

test('a test missing from one mode is a problem', () => {
	const reports = complete();

	reports[3] = parsed('production', 2, [['other', 4000]]);

	const problems = summarize(reports).problems.join('\n');

	assert.match(problems, /two" ran in development but not in production/);
	assert.match(problems, /other" ran in production but not in development/);
});

test('a missing shard report and a missing mode are problems', () => {
	const withoutShard = complete().slice(0, 3);

	assert.match(summarize(withoutShard).problems.join('\n'), /production shard 2\/2 has no report/);

	const withoutMode = complete().slice(0, 2);

	assert.match(summarize(withoutMode).problems.join('\n'), /no production report was found/);
});

test('rejects a report whose name carries no mode and shard', () => {
	assert.throws(() => parseReport('results.json', report(1, [])), /unexpected report name/);
});

test('a shard that ran no tests and a disagreement about the shard count are problems', () => {
	const reports = complete();

	reports[0] = parsed('development', 1, []);
	reports[2] = parsed('production', 1, [['one', 2000]], 3);

	const problems = summarize(reports).problems.join('\n');

	assert.match(problems, /development shard 1 ran no tests/);
	assert.match(
		problems,
		/production shard 2 reports 2 shards, not 3/
	);
});
