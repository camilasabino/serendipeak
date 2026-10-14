import { existsSync, readFileSync } from 'node:fs';
import { frozenSource, hashContractFiles, lockPath } from './contracts-lib.mjs';

const failures = [];

if (!existsSync(lockPath)) {
	console.error('contracts-verify: contracts/v1.lock.json is missing');
	process.exit(1);
}

const lock = JSON.parse(readFileSync(lockPath, 'utf8'));

for (const field of ['repository', 'tag', 'commit']) {
	if (lock.source?.[field] !== frozenSource[field]) {
		failures.push(`source.${field} is ${lock.source?.[field]}, expected ${frozenSource[field]}`);
	}
}

const actual = hashContractFiles();
const locked = lock.files ?? {};

for (const path of Object.keys(locked)) {
	if (!(path in actual)) {
		failures.push(`missing: ${path}`);
	} else if (actual[path].sha256 !== locked[path].sha256 || actual[path].bytes !== locked[path].bytes) {
		failures.push(`modified: ${path}`);
	}
}

for (const path of Object.keys(actual)) {
	if (!(path in locked)) {
		failures.push(`unexpected: ${path}`);
	}
}

if (failures.length > 0) {
	console.error('contracts-verify: FAILED');
	for (const failure of failures) {
		console.error(`  ${failure}`);
	}
	process.exit(1);
}

console.log(`contracts-verify: OK (${Object.keys(locked).length} files, ${lock.source.tag} @ ${lock.source.commit})`);
