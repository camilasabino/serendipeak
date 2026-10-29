import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Starting set carried over from the v1 production gate.
const forbiddenIdentifiers = [
	'__serendipeak',
	'exploreTo',
	'providerLab',
	'maptiler',
	'serendipeak:dev',
	'Camera preview editor'
];

const scannedSubdirectories = ['static', 'server'];

const buildDirectory = process.argv[2];
if (!buildDirectory || process.argv.length > 3) {
	console.error('usage: node scripts/production-gate.mjs <next-build-directory>');
	process.exit(2);
}

const root = resolve(buildDirectory);
const roots = scannedSubdirectories.map((name) => join(root, name));
const missing = roots.filter((path) => !existsSync(path));
if (missing.length > 0) {
	console.error(`production-gate: missing build output: ${missing.join(', ')}`);
	process.exit(1);
}

function* walk(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			yield* walk(path);
		} else {
			yield path;
		}
	}
}

const findings = [];
let scannedFiles = 0;
for (const directory of roots) {
	for (const file of walk(directory)) {
		scannedFiles += 1;
		const content = readFileSync(file, 'utf8');
		for (const identifier of forbiddenIdentifiers) {
			if (content.includes(identifier)) {
				findings.push(`${file}: ${identifier}`);
			}
		}
	}
}

if (findings.length > 0) {
	console.error(`production-gate: forbidden identifiers in build output\n${findings.join('\n')}`);
	process.exit(1);
}

console.log(
	`production-gate: ${scannedFiles} files scanned, none of ${forbiddenIdentifiers.length} identifiers found`
);
