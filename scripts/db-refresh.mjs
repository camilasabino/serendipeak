import { spawn } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = join(ROOT, 'services/api');
const LOCK_DIR = join(tmpdir(), 'serendipeak-db-refresh.lock');

const RAILWAY = { project: 'serendipeak', environment: 'production', service: 'postgres' };
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const DATABASE_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const STAMP = /^\d{8}t\d{6}$/;
const TUNNEL_TIMEOUT_MS = 120_000;
const MEDIA_CHECK_TIMEOUT_MS = 180_000;

// Every connection to production carries this: PostgreSQL then refuses any write in the session,
// whatever the command asks for. The timeout keeps a stalled tunnel from hanging the refresh.
export const READ_ONLY_OPTIONS = '-c default_transaction_read_only=on -c statement_timeout=120000';

const PROBE_CODE = [
	'import json',
	'from django.db import connection',
	'with connection.cursor() as cursor:',
	'    cursor.execute("select current_database(), current_setting(\'transaction_read_only\'), (select system_identifier::text from pg_control_system()), pg_is_in_recovery()")',
	'    database, read_only, system, recovery = cursor.fetchone()',
	"print('PROBE ' + json.dumps({'database': database, 'readOnly': read_only, 'system': system, 'recovery': recovery}))",
].join('\n');

export class RefreshError extends Error {}

// A Django traceback is long and only its last lines say what went wrong.
export function tail(text, lines = 12) {
	return text.trim().split('\n').slice(-lines).join('\n');
}

export function parseEnv(text) {
	const values = {};

	for (const raw of text.split('\n')) {
		const line = raw.trim().replace(/^export\s+/, '');
		if (!line || line.startsWith('#')) continue;

		const index = line.indexOf('=');
		if (index < 1) continue;

		let value = line.slice(index + 1).trim();
		const quote = value[0];
		if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
			value = value.slice(1, -1);
		} else {
			value = value.replace(/\s+#.*$/, '');
		}

		values[line.slice(0, index).trim()] = value;
	}

	return values;
}

export function parseDatabaseUrl(value, label) {
	let url;
	try {
		url = new URL(value ?? '');
	} catch {
		throw new RefreshError(`${label}: DATABASE_URL is missing or is not a URL.`);
	}

	if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
		throw new RefreshError(`${label}: DATABASE_URL must use the postgres scheme.`);
	}
	if (!LOOPBACK_HOSTS.has(url.hostname)) {
		throw new RefreshError(`${label}: DATABASE_URL must point at this machine (127.0.0.1).`);
	}
	if (!url.port) {
		throw new RefreshError(`${label}: DATABASE_URL must name an explicit port.`);
	}

	const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
	if (!DATABASE_NAME.test(name)) {
		throw new RefreshError(`${label}: the database name must match ${DATABASE_NAME}.`);
	}

	return {
		host: url.hostname,
		port: Number(url.port),
		name,
		user: decodeURIComponent(url.username),
		password: decodeURIComponent(url.password),
		url,
	};
}

export function readSourceConfig(operatorEnv) {
	if (operatorEnv.APP_ENV !== 'production') {
		throw new RefreshError('The operator file must have APP_ENV=production.');
	}

	return parseDatabaseUrl(operatorEnv.DATABASE_URL, 'Operator file');
}

export function readTargetConfig(env, publishedPort) {
	if (env.APP_ENV !== 'development') {
		throw new RefreshError(
			'The local environment file must have APP_ENV=development: the refresh only replaces a development database.'
		);
	}

	const target = parseDatabaseUrl(env.DATABASE_URL, 'Local environment file');
	if (target.port !== publishedPort) {
		throw new RefreshError(
			`DATABASE_URL points at port ${target.port}, but the compose database is published on ${publishedPort}.`
		);
	}

	return target;
}

export function assertDistinctServers(source, target) {
	if (source.port === target.port) {
		throw new RefreshError(
			`Source and destination use the same local port (${source.port}): refusing to continue.`
		);
	}
}

export function assertOperatorFile(path, repositoryRoot = ROOT) {
	if (!path) {
		throw new RefreshError(
			'Set OPERATOR_ENV to the operator environment file (docs/deployment.md, "Operator shell").'
		);
	}
	if (!isAbsolute(path) || !existsSync(path)) {
		throw new RefreshError('OPERATOR_ENV must be the absolute path of an existing file.');
	}

	const real = realpathSync(path);
	const fromRepository = relative(realpathSync(repositoryRoot), real);
	if (!fromRepository.startsWith('..') && !isAbsolute(fromRepository)) {
		throw new RefreshError('The operator file must live outside the repository.');
	}
	if ((statSync(real).mode & 0o077) !== 0) {
		throw new RefreshError(
			'The operator file must not be readable by group or others (chmod 600).'
		);
	}

	return real;
}

export function refreshNames(liveName, date = new Date()) {
	const stamp = date
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d+Z$/, '')
		.toLowerCase();

	return {
		stamp,
		candidate: `${liveName}_refresh_${stamp}`,
		backup: `${liveName}_pre_refresh_${stamp}`,
		retired: `${liveName}_pre_restore_${stamp}`,
	};
}

export function isRefreshBackup(liveName, name) {
	const prefix = `${liveName}_pre_refresh_`;
	return name.startsWith(prefix) && STAMP.test(name.slice(prefix.length));
}

export function extractContentSha(output) {
	const match = /^content_sha256: ([0-9a-f]{64})$/m.exec(output);
	if (!match) throw new RefreshError('The export did not report a content_sha256.');
	return match[1];
}

export function makeRedactor(...groups) {
	const secrets = new Set();

	for (const { values, minimumLength } of groups) {
		for (const [key, value] of Object.entries(values)) {
			if (!/SECRET|PASSWORD|TOKEN|KEY|DATABASE_URL/i.test(key)) continue;
			if (value.length >= minimumLength) secrets.add(value);

			if (key === 'DATABASE_URL') {
				try {
					const { password } = new URL(value);
					if (password.length >= minimumLength) {
						secrets.add(password);
						secrets.add(decodeURIComponent(password));
					}
				} catch {
					// Not a URL: the whole value is already covered above.
				}
			}
		}
	}

	const ordered = [...secrets].sort((a, b) => b.length - a.length);
	return (text) => ordered.reduce((out, secret) => out.split(secret).join('***'), text);
}

// The only commands that may ever run against production, and the only way they are built.
export function assertReadOnlyCommand(args) {
	const [command] = args;
	const isExport =
		command === 'export_catalog_snapshot' && args[1] === '--output' && args.length === 3;
	const isProbe =
		command === 'shell' && args[1] === '-c' && args[2] === PROBE_CODE && args.length === 3;

	if (!isExport && !isProbe) {
		throw new RefreshError(`Refusing to run "${command}" against production.`);
	}
}

export class ProductionReader {
	constructor({ exec, operatorFile, apiDir = API_DIR }) {
		this.exec = exec;
		this.operatorFile = operatorFile;
		this.apiDir = apiDir;
	}

	async run(args) {
		assertReadOnlyCommand(args);

		return this.exec(
			'uv',
			['run', '--env-file', this.operatorFile, 'python', 'manage.py', ...args],
			{
				cwd: this.apiDir,
				env: { PATH: process.env.PATH, HOME: process.env.HOME, PGOPTIONS: READ_ONLY_OPTIONS },
			}
		);
	}

	async probe() {
		const result = await this.run(['shell', '-c', PROBE_CODE]);
		const line = result.stdout.split('\n').find((entry) => entry.startsWith('PROBE '));
		if (result.code !== 0 || !line)
			return { ok: false, detail: tail(result.stderr || result.stdout) };

		return { ok: true, ...JSON.parse(line.slice('PROBE '.length)) };
	}

	async exportSnapshot(file) {
		const result = await this.run(['export_catalog_snapshot', '--output', file]);
		if (result.code !== 0) {
			throw new RefreshError(
				`Exporting the production catalog failed:\n${tail(result.stderr || result.stdout)}`
			);
		}

		return { sha: extractContentSha(result.stdout), report: result.stdout };
	}
}

export function assertSourceIdentity(probe, source, localSystem) {
	if (probe.database !== source.name) {
		throw new RefreshError(
			`The source reports database "${probe.database}", expected "${source.name}".`
		);
	}
	if (probe.readOnly !== 'on') {
		throw new RefreshError('The source session is not read-only: refusing to continue.');
	}
	if (probe.system === localSystem) {
		throw new RefreshError(
			'The source is the same PostgreSQL cluster as the destination: refusing to continue.'
		);
	}
}

export class LocalPostgres {
	constructor({ exec, container, user }) {
		this.exec = exec;
		this.container = container;
		this.user = user;
	}

	async #psql(database, args, input) {
		const result = await this.exec(
			'docker',
			[
				'exec',
				'-i',
				this.container,
				'psql',
				'-U',
				this.user,
				'-d',
				database,
				'-X',
				'-q',
				'-A',
				'-t',
				'-v',
				'ON_ERROR_STOP=1',
				...args,
			],
			{ input }
		);
		if (result.code !== 0) throw new RefreshError(`psql failed on ${database}:\n${result.stderr}`);

		return result.stdout.trim();
	}

	query(database, sql) {
		return this.#psql(database, ['-c', sql]);
	}

	async lines(database, sql) {
		const out = await this.query(database, sql);
		return out ? out.split('\n') : [];
	}

	transaction(database, sql) {
		return this.#psql(database, ['-1', '-f', '-'], sql);
	}

	async exists(name) {
		return (
			(await this.query('postgres', `select 1 from pg_database where datname = '${name}'`)) === '1'
		);
	}

	async hasTable(database, table) {
		return (
			(await this.query(database, `select to_regclass('public.${table}') is not null`)) === 't'
		);
	}

	async systemIdentifier() {
		return this.query('postgres', 'select system_identifier::text from pg_control_system()');
	}

	create(name) {
		return this.query('postgres', `create database "${name}"`);
	}

	drop(name) {
		return this.query('postgres', `drop database if exists "${name}" with (force)`);
	}

	async quiesce(name) {
		await this.query('postgres', `alter database "${name}" with allow_connections false`);
		await this.query(
			'postgres',
			`select pg_terminate_backend(pid) from pg_stat_activity where datname = '${name}' and pid <> pg_backend_pid()`
		);
	}

	reopen(name) {
		return this.query('postgres', `alter database "${name}" with allow_connections true`);
	}

	// Copies rows between two databases of this server through a pipe inside the container, so
	// nothing passes through this process.
	async copyTables(from, to, tables) {
		const flags = tables.flatMap((table) => ['-t', table]).join(' ');
		const script = `pg_dump -U "$0" -d "$1" --data-only --no-owner ${flags} | psql -U "$0" -d "$2" -X -q -v ON_ERROR_STOP=1 -1 >/dev/null`;
		const result = await this.exec('docker', [
			'exec',
			this.container,
			'bash',
			'-o',
			'pipefail',
			'-c',
			script,
			this.user,
			from,
			to,
		]);
		if (result.code !== 0)
			throw new RefreshError(`Copying ${tables.join(', ')} failed:\n${result.stderr}`);
	}
}

// Both renames commit together or not at all, so a failure never leaves the live name missing.
export async function swapDatabases(pg, { live, replacement, retired }) {
	await pg.quiesce(live);

	try {
		await pg.transaction(
			'postgres',
			[
				`alter database "${live}" rename to "${retired}";`,
				`alter database "${replacement}" rename to "${live}";`,
				`alter database "${retired}" with allow_connections true;`,
			].join('\n')
		);
	} catch (error) {
		await pg.reopen(live);
		throw error;
	}
}

export async function acquireLock(directory = LOCK_DIR) {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			mkdirSync(directory, { mode: 0o700 });
			writeFileSync(join(directory, 'pid'), String(process.pid));
			return () => rmSync(directory, { recursive: true, force: true });
		} catch (error) {
			if (error.code !== 'EEXIST') throw error;

			let owner = NaN;
			try {
				owner = Number(readFileSync(join(directory, 'pid'), 'utf8'));
			} catch {
				// A lock without a readable owner was abandoned halfway through its creation.
			}

			if (Number.isInteger(owner) && owner > 0 && isAlive(owner)) {
				throw new RefreshError(`Another refresh is running (PID ${owner}).`);
			}
			rmSync(directory, { recursive: true, force: true });
		}
	}

	throw new RefreshError('Could not acquire the refresh lock.');
}

function isAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === 'EPERM';
	}
}

function portAccepts(port) {
	return new Promise((resolvePort) => {
		const socket = net.connect({ host: '127.0.0.1', port });
		socket.once('connect', () => (socket.destroy(), resolvePort(true)));
		socket.once('error', () => resolvePort(false));
	});
}

export class RailwayTunnel {
	constructor({ exec, port, checkpoint }) {
		this.exec = exec;
		this.port = port;
		this.checkpoint = checkpoint;
		this.child = null;
	}

	async open(probe) {
		if (await portAccepts(this.port)) {
			throw new RefreshError(
				`Something already listens on port ${this.port}: the refresh opens and closes its own tunnel.`
			);
		}

		const status = await this.exec('railway', ['status'], {});
		const field = (label) => new RegExp(`^${label}:\\s+(.+)$`, 'm').exec(status.stdout)?.[1].trim();
		if (
			status.code !== 0 ||
			field('Project') !== RAILWAY.project ||
			field('Environment') !== RAILWAY.environment
		) {
			throw new RefreshError(
				`The linked Railway target is "${field('Project')}/${field('Environment')}", expected "${RAILWAY.project}/${RAILWAY.environment}".`
			);
		}

		let exited = false;
		this.child = spawn(
			'railway',
			[
				'connect',
				RAILWAY.service,
				'--tunnel-only',
				'-P',
				String(this.port),
				'-e',
				RAILWAY.environment,
			],
			{ cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] }
		);
		this.child.on('exit', () => (exited = true));
		this.child.on('error', () => (exited = true));
		let stderr = '';
		this.child.stderr.on('data', (chunk) => (stderr += chunk));

		const deadline = Date.now() + TUNNEL_TIMEOUT_MS;
		let last = { detail: 'the tunnel did not open' };
		while (Date.now() < deadline) {
			this.checkpoint();
			if (exited) throw new RefreshError(`The Railway tunnel exited early:\n${stderr}`);

			if (await portAccepts(this.port)) {
				last = await probe();
				if (last.ok) return last;
			}
			await sleep(3_000);
		}

		throw new RefreshError(`The Railway tunnel did not become usable in time:\n${last.detail}`);
	}

	async close() {
		if (!this.child) return;

		this.child.kill('SIGTERM');
		// The ssh process the CLI spawns survives its parent, so the listener is closed by port.
		const pids = await this.listeners();
		for (const pid of pids) {
			try {
				process.kill(pid, 'SIGTERM');
			} catch {
				// Already gone.
			}
		}

		for (let attempt = 0; attempt < 50; attempt++) {
			if (!(await portAccepts(this.port))) return;
			await sleep(100);
		}

		throw new RefreshError(
			`The tunnel on port ${this.port} is still open. Close it by hand: lsof -tiTCP:${this.port} -sTCP:LISTEN | xargs kill`
		);
	}

	async listeners() {
		const result = await this.exec('lsof', ['-tiTCP:' + this.port, '-sTCP:LISTEN']);
		return result.stdout.split('\n').filter(Boolean).map(Number);
	}
}

export function createExec({ redact }) {
	return function exec(command, args, { cwd = ROOT, env = process.env, input, timeoutMs } = {}) {
		return new Promise((resolveRun, reject) => {
			const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
			let stdout = '';
			let stderr = '';
			let timedOut = false;
			const timer = timeoutMs
				? setTimeout(() => ((timedOut = true), child.kill('SIGKILL')), timeoutMs)
				: null;

			child.stdout.on('data', (chunk) => (stdout += chunk));
			child.stderr.on('data', (chunk) => (stderr += chunk));
			child.on('error', (error) => (clearTimeout(timer), reject(error)));
			child.on('close', (code) => {
				clearTimeout(timer);
				resolveRun({ code, stdout: redact(stdout), stderr: redact(stderr), timedOut });
			});
			child.stdin.on('error', () => {});
			child.stdin.end(input ?? '');
		});
	};
}

const ACCOUNT_TABLES = ['app_user', 'django_session'];
const ACCOUNT_FINGERPRINT = [
	"select count(*) || ':' || coalesce(md5(string_agg(concat_ws('|', id, username, password, role, is_active), ',' order by id)), '') from app_user",
	"select count(*) || ':' || coalesce(md5(string_agg(concat_ws('|', session_key, session_data), ',' order by session_key)), '') from django_session",
];

async function accountFingerprint(pg, database) {
	const parts = [];
	for (const sql of ACCOUNT_FINGERPRINT) parts.push(await pg.query(database, sql));
	return parts.join(' ');
}

export async function refresh(options, io) {
	const { log, signal } = io;
	const cleanups = [];
	const defer = (label, action) => cleanups.push({ label, action });
	const checkpoint = () => signal.throwIfAborted();
	// Where a failure leaves the local database: untouched until the swap starts.
	let state = 'untouched';

	try {
		const release = await acquireLock();
		defer('release the lock', release);

		const targetEnvFile = resolve(options.envFile);
		const targetEnv = parseEnv(readFileSync(targetEnvFile, 'utf8'));
		const operatorFile = options.restore ? null : assertOperatorFile(process.env.OPERATOR_ENV);
		const operatorEnv = operatorFile ? parseEnv(readFileSync(operatorFile, 'utf8')) : {};
		io.addSecrets(targetEnv, operatorEnv);
		const exec = io.exec;

		log('Starting the local PostGIS container if needed.');
		const compose = await exec('docker', ['compose', 'up', '-d', '--wait']);
		if (compose.code !== 0) throw new RefreshError(`docker compose up failed:\n${compose.stderr}`);

		const container = (await exec('docker', ['compose', 'ps', '-q', 'db'])).stdout.trim();
		const published = await exec('docker', ['compose', 'port', 'db', '5432']);
		const publishedPort = Number(published.stdout.trim().split(':').pop());
		if (!container || !publishedPort)
			throw new RefreshError('The compose database is not running.');

		const target = readTargetConfig(targetEnv, publishedPort);
		const pg = new LocalPostgres({ exec, container, user: target.user });
		const localSystem = await pg.systemIdentifier();
		const names = refreshNames(target.name);

		if (!(await pg.exists(target.name))) {
			throw new RefreshError(`The local database "${target.name}" does not exist.`);
		}

		if (options.restore) {
			if (!isRefreshBackup(target.name, options.restore) || !(await pg.exists(options.restore))) {
				throw new RefreshError(`"${options.restore}" is not a backup made by this command.`);
			}

			log(
				`Restoring ${options.restore} as "${target.name}". The current one is kept as ${names.retired}.`
			);
			await swapDatabases(pg, {
				live: target.name,
				replacement: options.restore,
				retired: names.retired,
			});
			log(
				`Done. "${target.name}" is ${options.restore} again; the one it replaced is ${names.retired}.`
			);
			return;
		}

		const source = readSourceConfig(operatorEnv);
		assertDistinctServers(source, target);

		const reader = new ProductionReader({ exec, operatorFile });
		if (options.noTunnel) {
			log(`Using the source already reachable on 127.0.0.1:${source.port}.`);
		} else {
			log(
				`Opening the Railway tunnel on 127.0.0.1:${source.port} (${RAILWAY.project}/${RAILWAY.environment}).`
			);
		}

		const tunnel = new RailwayTunnel({ exec, port: source.port, checkpoint });
		if (!options.noTunnel) defer('close the Railway tunnel', () => tunnel.close());

		const probe = options.noTunnel ? await reader.probe() : await tunnel.open(() => reader.probe());
		if (!probe.ok) throw new RefreshError(`Could not read the source database:\n${probe.detail}`);

		assertSourceIdentity(probe, source, localSystem);
		log(
			`Source:      "${probe.database}" through 127.0.0.1:${source.port}, PostgreSQL system ${probe.system}, read-only session.`
		);
		log(
			`Destination: "${target.name}" in ${container.slice(0, 12)} on 127.0.0.1:${target.port}, PostgreSQL system ${localSystem}.`
		);

		const work = mkdtempSync(join(tmpdir(), 'serendipeak-refresh-'));
		defer('remove the temporary snapshot directory', () =>
			rmSync(work, { recursive: true, force: true })
		);

		log('Exporting the production catalog twice; both exports must be identical.');
		let snapshot = null;
		for (let attempt = 1; attempt <= 3 && !snapshot; attempt++) {
			checkpoint();
			const first = join(work, `a-${attempt}.json`);
			const second = join(work, `b-${attempt}.json`);
			const one = await reader.exportSnapshot(first);
			const two = await reader.exportSnapshot(second);

			if (one.sha === two.sha && readFileSync(first).equals(readFileSync(second))) {
				snapshot = { file: first, sha: one.sha, report: one.report };
			} else {
				log(`The catalog changed during export attempt ${attempt}; trying again.`);
			}
		}
		if (!snapshot)
			throw new RefreshError('Production kept changing during the export; try again in a moment.');
		for (const line of snapshot.report.trim().split('\n')) log(`  ${line}`);

		const targetUrl = (database) => {
			const url = new URL(target.url);
			url.pathname = `/${database}`;
			return url.toString();
		};
		const manage = (database, args, extra = {}) =>
			exec('uv', ['run', '--env-file', targetEnvFile, 'python', 'manage.py', ...args], {
				cwd: API_DIR,
				env: { PATH: process.env.PATH, HOME: process.env.HOME, DATABASE_URL: targetUrl(database) },
				...extra,
			});
		const mustManage = async (database, args, label) => {
			const result = await manage(database, args);
			if (result.code !== 0)
				throw new RefreshError(`${label} failed:\n${tail(result.stderr || result.stdout)}`);
			for (const line of result.stdout.trim().split('\n').filter(Boolean)) log(`  ${line}`);
			return result;
		};

		checkpoint();
		log(`Creating the temporary database "${names.candidate}".`);
		await pg.create(names.candidate);
		defer('drop the temporary database', () => pg.drop(names.candidate));

		const snapshotArgs = ['--input', snapshot.file, '--sha256', snapshot.sha];
		log('Applying migrations to it.');
		const migrate = await manage(names.candidate, ['migrate', '--noinput']);
		if (migrate.code !== 0)
			throw new RefreshError(`migrate failed:\n${tail(migrate.stderr || migrate.stdout)}`);
		checkpoint();
		log('Loading the snapshot.');
		await mustManage(
			names.candidate,
			['load_catalog_snapshot', ...snapshotArgs],
			'load_catalog_snapshot'
		);
		log('Verifying the snapshot against the loaded catalog.');
		await mustManage(
			names.candidate,
			['verify_catalog_snapshot', ...snapshotArgs],
			'verify_catalog_snapshot'
		);
		log('Checking the publication invariants.');
		await mustManage(names.candidate, ['check_catalog'], 'check_catalog');

		checkpoint();
		let accounts = null;
		if (await pg.hasTable(target.name, 'app_user')) {
			log('Carrying the local Studio accounts and sessions over from the current local database.');
			await pg.copyTables(target.name, names.candidate, ACCOUNT_TABLES);

			const before = await accountFingerprint(pg, target.name);
			const after = await accountFingerprint(pg, names.candidate);
			if (before !== after)
				throw new RefreshError('The copied accounts do not match the local originals.');
			accounts = after;
		} else {
			log('The current local database has no accounts table; nothing to carry over.');
		}

		const slugs = (database) => pg.lines(database, 'select slug from mountain order by slug');
		const current = new Set(await slugs(target.name).catch(() => []));
		const incoming = new Set(await slugs(names.candidate));
		const added = [...incoming].filter((slug) => !current.has(slug));
		const dropped = [...current].filter((slug) => !incoming.has(slug));
		log(
			`Catalog: ${incoming.size} mountains from production (${added.length} not in the local catalog, ${dropped.length} local-only).`
		);
		if (added.length > 0)
			log(`  New locally: ${added.slice(0, 20).join(', ')}${added.length > 20 ? ', …' : ''}`);
		if (dropped.length > 0)
			log(
				`  Local-only, kept only in the backup: ${dropped.slice(0, 20).join(', ')}${dropped.length > 20 ? ', …' : ''}`
			);

		log('Checking which photographs exist in the local media store (informational).');
		const media = await manage(names.candidate, ['check_photograph_media', '--deep'], {
			timeoutMs: MEDIA_CHECK_TIMEOUT_MS,
		});
		const problems = /(\d+) of (\d+) photographs have media problems/.exec(media.stderr);
		if (media.timedOut) {
			log('  Not checked: the local media store did not answer in time.');
		} else if (media.code === 0) {
			log('  Every photograph has its objects in the local media store.');
		} else if (problems) {
			log(
				`  ${problems[1]} of ${problems[2]} photographs are not in the local media store and will not display locally (see "Photographs after a refresh" in the developer reference).`
			);
		} else {
			log(`  The check could not run:\n${media.stderr.trim()}`);
		}

		if (options.dryRun) {
			log('Dry run: the local database was not changed.');
			return;
		}

		checkpoint();
		log(
			`Replacing "${target.name}": connections to it are closed and it is kept as ${names.backup}.`
		);
		state = 'swapping';
		await swapDatabases(pg, {
			live: target.name,
			replacement: names.candidate,
			retired: names.backup,
		});
		state = 'swapped';

		try {
			const check = await manage(target.name, ['check_catalog'], {});
			if (check.code !== 0)
				throw new RefreshError(`check_catalog on the new database failed:\n${tail(check.stderr)}`);
			if (accounts !== null && (await accountFingerprint(pg, target.name)) !== accounts) {
				throw new RefreshError('The accounts changed during the swap.');
			}
		} catch (error) {
			log('The new database failed its final check: restoring the previous one.');
			await swapDatabases(pg, {
				live: target.name,
				replacement: names.backup,
				retired: names.candidate,
			});
			state = 'restored';
			throw error;
		}

		const backups = (
			await pg.lines('postgres', 'select datname from pg_database order by datname')
		).filter((name) => isRefreshBackup(target.name, name));
		log(`Done. "${target.name}" now holds the production catalog (${incoming.size} mountains).`);
		log(
			`Previous local database kept as ${names.backup}. Restore it with: npm run db:refresh -- --restore ${names.backup}`
		);
		if (backups.length > 1)
			log(
				`Backups from earlier refreshes: ${backups.filter((name) => name !== names.backup).join(', ')}.`
			);
	} catch (error) {
		const outcome = {
			untouched: 'The local database was not modified.',
			swapping: 'The local database was not modified (the swap is a single transaction).',
			restored: 'The local database is the previous one again; nothing was lost.',
			swapped: `The swap happened but its final check could not run to completion: inspect "${options.envFile}" and the backups before trusting it.`,
		}[state];
		log(outcome);
		throw error;
	} finally {
		for (const { label, action } of cleanups.reverse()) {
			try {
				await action();
			} catch (error) {
				log(`Cleanup failed (${label}): ${error.message}`);
				process.exitCode = 1;
			}
		}
	}
}

const USAGE = `Usage: npm run db:refresh [-- options]

Replaces the local development catalog with the production catalog. Needs OPERATOR_ENV.

  --dry-run          do everything except replace the local database
  --restore <name>   put back a <database>_pre_refresh_<timestamp> backup
  --no-tunnel        use a source already reachable at the operator file's DATABASE_URL
  --env-file <file>  destination environment file (default: the repository's .env)
`;

function readOptions() {
	try {
		const { values } = parseArgs({
			options: {
				help: { type: 'boolean', default: false },
				'dry-run': { type: 'boolean', default: false },
				'no-tunnel': { type: 'boolean', default: false },
				'env-file': { type: 'string', default: join(ROOT, '.env') },
				restore: { type: 'string' },
			},
		});

		return values;
	} catch (error) {
		console.error(`db-refresh: ${error.message}\n\n${USAGE}`);
		process.exit(2);
	}
}

async function main() {
	const values = readOptions();
	if (values.help) {
		console.log(USAGE);
		return;
	}

	const controller = new AbortController();
	// The terminal also signals the child processes, so the running step ends on its own; the next
	// checkpoint then stops the run and the cleanup closes the tunnel and drops the temporary database.
	for (const name of ['SIGINT', 'SIGTERM']) {
		process.on(name, () => {
			console.error(
				`\ndb-refresh: ${name} received; ${controller.signal.aborted ? 'still' : 'stopping and'} cleaning up.`
			);
			controller.abort();
		});
	}

	let redact = (text) => text;
	const log = (message) => console.log(`db-refresh: ${redact(message)}`);
	const exec = createExec({ redact: (text) => redact(text) });

	try {
		await refresh(
			{
				dryRun: values['dry-run'],
				noTunnel: values['no-tunnel'],
				envFile: values['env-file'],
				restore: values.restore,
			},
			{
				log,
				exec,
				signal: controller.signal,
				addSecrets: (target, operator) => {
					redact = makeRedactor(
						{ values: operator, minimumLength: 8 },
						{ values: target, minimumLength: 12 }
					);
				},
			}
		);
	} catch (error) {
		const message = redact(
			error instanceof RefreshError
				? error.message
				: error.name === 'AbortError'
					? 'stopped before the next step'
					: (error.stack ?? String(error))
		);
		console.error(
			`db-refresh: ${controller.signal.aborted ? 'interrupted' : 'failed'}: ${message}`
		);
		process.exitCode = controller.signal.aborted ? 130 : 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
