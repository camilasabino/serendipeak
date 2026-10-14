import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const contractsDir = join(repoRoot, 'contracts', 'v1');
export const lockPath = join(repoRoot, 'contracts', 'v1.lock.json');

export const frozenSource = Object.freeze({
	repository: 'camilasabino/serendipeak-legacy',
	tag: 'v1-behavioral-freeze',
	commit: 'f9a66deb2c0591a9c574fb4751b938b5863e6a1e'
});

export const lockedPrefix = 'contracts/v1/';

function listFiles(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		return entry.isDirectory() ? listFiles(path) : [path];
	});
}

export function hashContractFiles() {
	const files = {};
	for (const path of listFiles(contractsDir).sort()) {
		const bytes = readFileSync(path);
		const key = relative(repoRoot, path).split(sep).join('/');
		files[key] = {
			sha256: createHash('sha256').update(bytes).digest('hex'),
			bytes: bytes.length
		};
	}
	return files;
}
