import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ports = { api: 8000, web: 3000 };

function listeningPids(port) {
	try {
		const out = execFileSync('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8' });
		return out.split('\n').filter(Boolean).map(Number);
	} catch {
		return [];
	}
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

let failed = false;

for (const [name, port] of Object.entries(ports)) {
	const pids = listeningPids(port);
	if (pids.length === 0) {
		console.log(`${name}: not running on :${port}`);
		continue;
	}

	for (const pid of pids) process.kill(pid, 'SIGTERM');

	for (let attempt = 0; attempt < 50 && listeningPids(port).length > 0; attempt++) {
		await sleep(100);
	}

	if (listeningPids(port).length > 0) {
		console.error(`${name}: port ${port} is still in use by PID ${listeningPids(port).join(', ')}`);
		failed = true;
	} else {
		console.log(`${name}: stopped`);
	}
}

// stop keeps the database volume; only `docker compose down -v` deletes data.
try {
	execFileSync('docker', ['compose', 'stop'], { cwd: root, stdio: 'inherit' });
} catch {
	failed = true;
}

process.exit(failed ? 1 : 0);
