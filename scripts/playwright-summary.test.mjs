import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseReport, summarize } from './playwright-summary.mjs';

const PLAIN = '@webgl static stage';
const LIFECYCLE = '@webgl @lifecycle stage lifecycle';

function report(shard, groups, total = 2) {
	return {
		config: { shard: { current: shard, total } },
		stats: { duration: 5000 },
		suites: [
			{
				title: 'stage.spec.ts',
				file: 'stage.spec.ts',
				specs: [],
				suites: Object.entries(groups).map(([title, specs]) => ({
					title,
					file: 'stage.spec.ts',
					specs: specs.map(([name, duration, status = 'expected']) => ({
						title: name,
						file: 'stage.spec.ts',
						tests: [{ status, results: [{ duration }] }]
					}))
				}))
			}
		]
	};
}

function parsed(mode, shard, groups, total) {
	return parseReport(`webgl-${mode}-${shard}.json`, report(shard, groups, total));
}

const complete = () => [
	parsed('development', 1, { [LIFECYCLE]: [['boot', 1000]] }, 1),
	parsed('production', 1, {
		[LIFECYCLE]: [['boot', 2000]],
		[PLAIN]: [['one', 3000]]
	}),
	parsed('production', 2, { [PLAIN]: [['two', 4000]] })
];

test('builds test identities from the spec file and its describe titles', () => {
	const [development] = complete();

	assert.equal(development.mode, 'development');
	assert.equal(development.shard, 1);
	assert.equal(development.total, 1);
	assert.equal(development.tests[0].id, `stage.spec.ts › ${LIFECYCLE} › boot`);
});

test('a complete run with production-only tests and shared lifecycle tests has no problems', () => {
	assert.deepEqual(summarize(complete()).problems, []);
});

test('reports shard imbalance and the slowest test', () => {
	const { markdown } = summarize(complete());

	assert.match(markdown, /\| production \| 3 \| 0\.1 min \| 0\.1 min \| 0\.1 min \| 20% \|/);
	assert.match(
		markdown,
		/\| 4\.0s \| production \| stage\.spec\.ts › @webgl static stage › two \|/
	);
});

test('a test that ran in two shards of one mode is a problem', () => {
	const reports = complete();

	reports[2] = parsed('production', 2, {
		[PLAIN]: [
			['one', 3000],
			['two', 4000]
		]
	});

	assert.match(summarize(reports).problems.join('\n'), /production: .* ran more than once/);
});

test('a test that ran in development without the lifecycle tag is a problem', () => {
	const reports = complete();

	reports[0] = parsed(
		'development',
		1,
		{ [LIFECYCLE]: [['boot', 1000]], [PLAIN]: [['one', 1000]] },
		1
	);

	assert.match(
		summarize(reports).problems.join('\n'),
		/one" ran in development but is not tagged @lifecycle/
	);
});

test('a lifecycle test missing from development is a problem', () => {
	const reports = complete();

	reports[0] = parsed('development', 1, { [LIFECYCLE]: [['other', 1000]] }, 1);

	const problems = summarize(reports).problems.join('\n');

	assert.match(problems, /boot" is tagged @lifecycle but did not run in development/);
	assert.match(problems, /other" ran in development but not in production/);
});

test('a missing shard report and a missing mode are problems', () => {
	const withoutShard = complete().slice(0, 2);

	assert.match(summarize(withoutShard).problems.join('\n'), /production shard 2\/2 has no report/);

	const withoutMode = complete().slice(0, 1);

	assert.match(summarize(withoutMode).problems.join('\n'), /no production report was found/);
});

test('rejects a report whose name carries no mode and shard', () => {
	assert.throws(() => parseReport('results.json', report(1, {})), /unexpected report name/);
});

test('a shard that ran no tests and a disagreement about the shard count are problems', () => {
	const reports = complete();

	reports[0] = parsed('development', 1, {}, 1);
	reports[1] = parsed('production', 1, { [LIFECYCLE]: [['boot', 2000]] }, 3);

	const problems = summarize(reports).problems.join('\n');

	assert.match(problems, /development shard 1 ran no tests/);
	assert.match(problems, /production shard 2 reports 2 shards, not 3/);
});
