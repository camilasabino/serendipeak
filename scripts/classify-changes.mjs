import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// A change skips the browser suites only when every changed path is on this list: nothing in the
// build, the runtime or the tests reads these files. The list is deliberately an allowlist, so
// any new kind of path runs the suites until someone decides otherwise.
const INERT_PATTERNS = [/^docs\//, /^[^/]+\.md$/i];

export function requiresWebgl(paths) {
	if (paths.length === 0) {
		return { required: true, reason: 'no changed files were found' };
	}

	const relevant = paths.filter((path) => !INERT_PATTERNS.some((pattern) => pattern.test(path)));

	if (relevant.length > 0) {
		return { required: true, reason: `${relevant.length} changed file(s) can affect the app` };
	}

	return { required: false, reason: `all ${paths.length} changed file(s) are documentation` };
}

const SHA = /^[0-9a-f]{40}$/;
const NULL_SHA = /^0{40}$/;

function commitExists(sha) {
	try {
		execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

function changedPaths(event, base, head) {
	for (const sha of [base, head]) {
		if (!SHA.test(sha ?? '') || NULL_SHA.test(sha) || !commitExists(sha)) {
			throw new Error(`revision ${sha || '(empty)'} is not a commit available locally`);
		}
	}

	// A pull request is compared with the merge base, so commits that landed on the base branch
	// after it was opened are not its changes. A push is compared tree to tree: after a force push
	// the previous tip is not an ancestor, and every commit it brings in must count. Without rename
	// detection a moved file reports both its old and its new path.
	const range = event === 'push' ? `${base}..${head}` : `${base}...${head}`;
	const output = execFileSync(
		'git',
		['-c', 'core.quotepath=off', 'diff', '--name-only', '--no-renames', '-z', range],
		{ encoding: 'utf8' }
	);

	return output.split('\0').filter(Boolean);
}

function main(event, base, head) {
	let decision;

	try {
		if (event !== 'push' && event !== 'pull_request') {
			throw new Error(`unsupported event ${event || '(none)'}`);
		}

		decision = requiresWebgl(changedPaths(event, base, head));
	} catch (error) {
		decision = { required: true, reason: `changes could not be classified (${error.message})` };
	}

	console.error(`classify-changes: webgl=${decision.required} (${decision.reason})`);
	console.log(`webgl=${decision.required}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main(process.argv[2], process.argv[3], process.argv[4]);
}
