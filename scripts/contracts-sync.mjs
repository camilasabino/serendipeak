import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
	contractsDir,
	frozenSource,
	hashContractFiles,
	lockPath,
	repoRoot
} from './contracts-lib.mjs';

const legacyRepo = resolve(repoRoot, process.argv[2] ?? '../serendipeak-legacy');

function git(...args) {
	return execFileSync('git', ['-C', legacyRepo, ...args], { encoding: 'utf8' }).trim();
}

const commit = git('rev-parse', `${frozenSource.tag}^{commit}`);
if (commit !== frozenSource.commit) {
	console.error(`contracts-sync: tag ${frozenSource.tag} resolves to ${commit}, expected ${frozenSource.commit}`);
	process.exit(1);
}
const tagObject = git('rev-parse', frozenSource.tag);

const staging = mkdtempSync(join(tmpdir(), 'contracts-sync-'));
try {
	const archive = execFileSync('git', ['-C', legacyRepo, 'archive', frozenSource.tag, '--', 'contracts/v1']);
	execFileSync('tar', ['-x', '-C', staging], { input: archive });
	rmSync(contractsDir, { recursive: true, force: true });
	cpSync(join(staging, 'contracts', 'v1'), contractsDir, { recursive: true });
} finally {
	rmSync(staging, { recursive: true, force: true });
}

const lock = {
	source: { ...frozenSource, tagObject },
	syncedAt: new Date().toISOString().slice(0, 10),
	files: hashContractFiles()
};
writeFileSync(lockPath, `${JSON.stringify(lock, null, '\t')}\n`);
console.log(`contracts-sync: ${Object.keys(lock.files).length} files from ${frozenSource.tag} @ ${commit}`);
