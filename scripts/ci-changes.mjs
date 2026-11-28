import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const JOBS = ['api', 'web', 'contracts', 'scripts'];

const NO_JOBS = [];

// First match wins. Anything that matches no rule routes to every job, so a new top-level path
// can never silently skip checks.
const RULES = [
	{ test: (path) => path === 'README.md' || path.startsWith('docs/'), jobs: NO_JOBS },
	{ test: (path) => path.startsWith('apps/web/'), jobs: ['web'] },
	{ test: (path) => path.startsWith('services/api/'), jobs: ['api'] },
	{
		test: (path) =>
			path.startsWith('services/backup/') || path.startsWith('services/offsite-backup/'),
		jobs: ['scripts'],
	},
	// Fixtures are consumed by the API and web test suites and verified by the contracts job.
	{ test: (path) => path.startsWith('contracts/'), jobs: ['api', 'web', 'contracts'] },
	// The contracts tooling lives here and the scripts job tests it.
	{ test: (path) => path.startsWith('scripts/'), jobs: ['contracts', 'scripts'] },
];

/**
 * @param {string[]} files repository-relative paths from `git diff --name-only`
 * @returns {Record<'api' | 'web' | 'contracts' | 'scripts', boolean>}
 */
export function route(files) {
	if (files.length === 0) {
		return allJobs();
	}

	const selected = new Set();

	for (const file of files) {
		const rule = RULES.find((candidate) => candidate.test(file));

		if (!rule) {
			return allJobs();
		}

		for (const job of rule.jobs) {
			selected.add(job);
		}
	}

	return Object.fromEntries(JOBS.map((job) => [job, selected.has(job)]));
}

function allJobs() {
	return Object.fromEntries(JOBS.map((job) => [job, true]));
}

const NULL_SHA = /^0+$/;

/**
 * Resolves the diff range for a GitHub event, or null when the impact cannot be determined.
 */
export function diffRange({ eventName, baseSha, headSha, beforeSha, sha }) {
	if (eventName === 'pull_request' && baseSha && headSha) {
		return `${baseSha}...${headSha}`;
	}

	if (eventName === 'push' && beforeSha && !NULL_SHA.test(beforeSha) && sha) {
		return `${beforeSha}..${sha}`;
	}

	return null;
}

function changedFiles(range) {
	const output = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', range], {
		encoding: 'utf8',
	});

	return output.split('\0').filter(Boolean);
}

/**
 * Compares each job's result with what routing required. A routed job must succeed and an
 * unrouted one must be skipped, so an unexpected skip counts as a failure.
 *
 * @param {Record<string, {result: string, outputs?: Record<string, string>}>} needs
 * @returns {string[]} human-readable problems; empty when the run is healthy
 */
export function gateProblems(needs) {
	const routing = needs.changes;

	if (routing?.result !== 'success') {
		return [`changes: ${routing?.result ?? 'missing'}, expected success`];
	}

	const expectations = { commitlint: 'success' };

	for (const job of JOBS) {
		expectations[job] = routing.outputs?.[job] === 'true' ? 'success' : 'skipped';
	}

	return Object.entries(expectations)
		.filter(([job, expected]) => needs[job]?.result !== expected)
		.map(([job, expected]) => `${job}: ${needs[job]?.result ?? 'missing'}, expected ${expected}`);
}

function gate() {
	const problems = gateProblems(JSON.parse(process.env.NEEDS_JSON ?? '{}'));

	for (const problem of problems) {
		console.error(`ci-gate: ${problem}`);
	}

	if (problems.length > 0) {
		process.exit(1);
	}

	console.log('ci-gate: every job matched its routing');
}

function main() {
	const range = diffRange({
		eventName: process.env.EVENT_NAME,
		baseSha: process.env.BASE_SHA,
		headSha: process.env.HEAD_SHA,
		beforeSha: process.env.BEFORE_SHA,
		sha: process.env.GITHUB_SHA,
	});

	let routing;
	let reason;

	if (!range) {
		routing = allJobs();
		reason = 'no usable diff range';
	} else {
		try {
			const files = changedFiles(range);
			routing = route(files);
			reason = `${files.length} changed file(s) in ${range}`;
		} catch (error) {
			routing = allJobs();
			reason = `git diff failed (${error.message.split('\n')[0]})`;
		}
	}

	console.log(`ci-changes: ${reason}`);

	for (const job of JOBS) {
		console.log(`ci-changes: ${job}=${routing[job]}`);
	}

	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(
			process.env.GITHUB_OUTPUT,
			JOBS.map((job) => `${job}=${routing[job]}\n`).join(''),
		);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.argv[2] === 'gate') {
		gate();
	} else {
		main();
	}
}
