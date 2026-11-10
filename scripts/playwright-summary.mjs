import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPORT_NAME = /^webgl-(development|production)-(\d+)\.json$/;
const SLOWEST_TESTS = 15;

function collectTests(suite, titles, tests) {
	const path = suite.file && suite.title === suite.file ? titles : [...titles, suite.title];

	for (const spec of suite.specs ?? []) {
		for (const test of spec.tests ?? []) {
			const results = test.results ?? [];

			tests.push({
				id: [spec.file, ...path, spec.title].join(' › '),
				file: spec.file,
				title: [...path, spec.title].join(' › '),
				status: test.status,
				duration: results.reduce((sum, result) => sum + result.duration, 0)
			});
		}
	}

	for (const child of suite.suites ?? []) {
		collectTests(child, path, tests);
	}
}

export function parseReport(name, report) {
	const match = REPORT_NAME.exec(name);

	if (!match) {
		throw new Error(`unexpected report name: ${name}`);
	}

	const tests = [];

	for (const suite of report.suites ?? []) {
		collectTests(suite, [], tests);
	}

	return {
		mode: match[1],
		shard: Number(match[2]),
		total: report.config?.shard?.total ?? null,
		wall: report.stats?.duration ?? 0,
		tests
	};
}

const seconds = (milliseconds) => `${(milliseconds / 1000).toFixed(1)}s`;
const minutes = (milliseconds) => `${(milliseconds / 60000).toFixed(1)} min`;
const sum = (values) => values.reduce((total, value) => total + value, 0);

function checkIntegrity(reports) {
	const problems = [];
	const idsByMode = new Map();

	for (const mode of ['development', 'production']) {
		const ofMode = reports.filter((report) => report.mode === mode);
		const total = ofMode[0]?.total;
		const shards = new Set(ofMode.map((report) => report.shard));

		if (ofMode.length === 0 || !total) {
			problems.push(`no ${mode} report was found`);
			continue;
		}

		for (const report of ofMode) {
			if (report.total !== total) {
				problems.push(`${mode} shard ${report.shard} reports ${report.total} shards, not ${total}`);
			}

			if (report.tests.length === 0) {
				problems.push(`${mode} shard ${report.shard} ran no tests`);
			}
		}

		for (let shard = 1; shard <= total; shard++) {
			if (!shards.has(shard)) {
				problems.push(`${mode} shard ${shard}/${total} has no report`);
			}
		}

		const seen = new Set();

		for (const test of ofMode.flatMap((report) => report.tests)) {
			if (seen.has(test.id)) {
				problems.push(`${mode}: "${test.id}" ran more than once`);
			}

			seen.add(test.id);
		}

		idsByMode.set(mode, seen);
	}

	const development = idsByMode.get('development');
	const production = idsByMode.get('production');

	if (development && production) {
		for (const id of development) {
			if (!production.has(id)) {
				problems.push(`"${id}" ran in development but not in production`);
			}
		}

		for (const id of production) {
			if (!development.has(id)) {
				problems.push(`"${id}" ran in production but not in development`);
			}
		}
	}

	return problems;
}

function shardTable(reports) {
	const lines = [
		'| Mode | Shard | Tests | Failed | Test time | Wall time |',
		'| --- | --- | ---: | ---: | ---: | ---: |'
	];

	for (const report of reports) {
		const failed = report.tests.filter((test) => test.status === 'unexpected').length;
		const time = sum(report.tests.map((test) => test.duration));

		lines.push(
			`| ${report.mode} | ${report.shard}/${report.total ?? '?'} | ${report.tests.length} | ${failed} | ${seconds(time)} | ${seconds(report.wall)} |`
		);
	}

	return lines;
}

function modeTable(reports) {
	const lines = [
		'| Mode | Tests | Test time | Slowest shard | Fastest shard | Imbalance |',
		'| --- | ---: | ---: | ---: | ---: | ---: |'
	];

	for (const mode of ['development', 'production']) {
		const ofMode = reports.filter((report) => report.mode === mode);

		if (ofMode.length === 0) {
			continue;
		}

		const times = ofMode.map((report) => sum(report.tests.map((test) => test.duration)));
		const slowest = Math.max(...times);
		const fastest = Math.min(...times);
		const imbalance = slowest === 0 ? 0 : ((slowest - fastest) / slowest) * 100;

		lines.push(
			`| ${mode} | ${sum(ofMode.map((report) => report.tests.length))} | ${minutes(sum(times))} | ${minutes(slowest)} | ${minutes(fastest)} | ${imbalance.toFixed(0)}% |`
		);
	}

	return lines;
}

function specTable(reports) {
	const byFile = new Map();

	for (const report of reports) {
		for (const test of report.tests) {
			const entry = byFile.get(test.file) ?? { development: [], production: [] };

			entry[report.mode].push(test.duration);
			byFile.set(test.file, entry);
		}
	}

	const rows = [...byFile.entries()]
		.map(([file, entry]) => ({
			file,
			development: entry.development,
			production: entry.production
		}))
		.sort(
			(a, b) => sum(b.development) + sum(b.production) - sum(a.development) - sum(a.production)
		);

	const lines = ['| Spec | Tests | Development | Production |', '| --- | ---: | ---: | ---: |'];

	for (const row of rows) {
		lines.push(
			`| ${row.file} | ${row.development.length} | ${seconds(sum(row.development))} | ${seconds(sum(row.production))} |`
		);
	}

	return lines;
}

function slowestTable(reports) {
	const lines = ['| Time | Mode | Test |', '| ---: | --- | --- |'];
	const tests = reports
		.flatMap((report) => report.tests.map((test) => ({ ...test, mode: report.mode })))
		.sort((a, b) => b.duration - a.duration)
		.slice(0, SLOWEST_TESTS);

	for (const test of tests) {
		lines.push(`| ${seconds(test.duration)} | ${test.mode} | ${test.file} › ${test.title} |`);
	}

	return lines;
}

export function summarize(reports) {
	const ordered = [...reports].sort((a, b) => a.mode.localeCompare(b.mode) || a.shard - b.shard);
	const problems = checkIntegrity(ordered);

	const sections = [
		'## WebGL suites',
		'',
		'Test time is the sum of the durations of the tests; wall time also includes fixtures and worker start-up. Imbalance is how much shorter the fastest shard is than the slowest.',
		'',
		...shardTable(ordered),
		'',
		'### By mode',
		'',
		...modeTable(ordered),
		'',
		'### By spec',
		'',
		...specTable(ordered),
		'',
		`### Slowest ${SLOWEST_TESTS} tests`,
		'',
		...slowestTable(ordered),
		''
	];

	if (problems.length > 0) {
		sections.push('### Coverage problems', '', ...problems.map((problem) => `- ${problem}`), '');
	}

	return { markdown: sections.join('\n'), problems };
}

function main(directory) {
	const names = readdirSync(directory).filter((name) => REPORT_NAME.test(name));
	const reports = names.map((name) =>
		parseReport(name, JSON.parse(readFileSync(join(directory, name), 'utf8')))
	);
	const { markdown, problems } = summarize(reports);

	console.log(markdown);

	if (problems.length > 0) {
		console.error(`playwright-summary: ${problems.length} coverage problem(s)`);
		process.exitCode = 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main(process.argv[2]);
}
