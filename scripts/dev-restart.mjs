import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const logDir = join(root, '.dev-logs');

const services = [
	{
		name: 'api',
		port: 8000,
		cwd: join(root, 'services/api'),
		command: 'uv',
		args: ['run', '--env-file', '../../.env', 'python', 'manage.py', 'runserver'],
	},
	{
		name: 'web',
		port: 3000,
		cwd: join(root, 'apps/web'),
		command: 'npm',
		args: ['run', 'dev'],
	},
];

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

async function stop(port) {
	const pids = listeningPids(port);
	for (const pid of pids) process.kill(pid, 'SIGTERM');

	for (let attempt = 0; attempt < 50 && listeningPids(port).length > 0; attempt++) {
		await sleep(100);
	}

	const remaining = listeningPids(port);
	if (remaining.length > 0) {
		console.error(`dev-restart: port ${port} is still in use by PID ${remaining.join(', ')}`);
		process.exit(1);
	}
}

mkdirSync(logDir, { recursive: true });

for (const service of services) {
	await stop(service.port);

	const log = openSync(join(logDir, `${service.name}.log`), 'w');
	const child = spawn(service.command, service.args, {
		cwd: service.cwd,
		detached: true,
		stdio: ['ignore', log, log],
	});
	child.unref();

	console.log(`${service.name}: started on :${service.port} (logs: .dev-logs/${service.name}.log)`);
}
