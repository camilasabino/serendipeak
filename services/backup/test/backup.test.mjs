import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { after, afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../backup.sh', import.meta.url));
const stubsDir = fileURLToPath(new URL('./stubs/', import.meta.url));

const TOKEN = 'SECRETTOKEN123';
const HEARTBEAT = `https://heartbeat.test/api/v1/heartbeat/${TOKEN}`;

// The container runs busybox ash; dash is the closest shell available on Linux CI, and the macOS
// `sh` is bash in POSIX mode, which handles traps and expansion errors differently.
const shells = ['sh', 'dash'].filter((shell) =>
	(process.env.PATH ?? '').split(delimiter).some((directory) => existsSync(join(directory, shell)))
);

const baseEnv = {
	BACKUP_S3_ENDPOINT_URL: 'https://r2.test',
	BACKUP_S3_ACCESS_KEY_ID: 'access-key',
	BACKUP_S3_SECRET_ACCESS_KEY: 'secret-key',
	BACKUP_BUCKET: 'test-bucket',
	PGHOST: 'db.test',
	PGUSER: 'user',
	PGPASSWORD: 'password',
	PGDATABASE: 'serendipeak'
};

const sandboxes = [];

// The stubs keep no state (they read $STATE), so one copy serves every test. Fresh executables are
// scanned on first run on macOS, which made a copy per test cost seconds.
const sharedBin = mkdtempSync(join(tmpdir(), 'backup-stubs-'));
for (const name of ['curl', 'date', 'pg_dump', 'pg_restore', 'sha256sum', 'timeout']) {
	copyFileSync(join(stubsDir, name), join(sharedBin, name));
	chmodSync(join(sharedBin, name), 0o755);
}

after(() => {
	rmSync(sharedBin, { recursive: true, force: true });
});

afterEach(() => {
	for (const sandbox of sandboxes.splice(0)) {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

function createSandbox() {
	const root = mkdtempSync(join(tmpdir(), 'backup-test-'));
	sandboxes.push(root);

	const state = join(root, 'state');
	const scratch = join(root, 'scratch');
	mkdirSync(join(state, 'bucket'), { recursive: true });
	mkdirSync(scratch);

	return { root, bin: sharedBin, state, scratch };
}

// Places a dump and its checksum in the fake bucket, as an earlier run would have.
function seedDump(sandbox, stamp, { content = 'older dump\n', checksum } = {}) {
	const key = `daily/serendipeak-${stamp}.dump`;
	const target = join(sandbox.state, 'bucket', key);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, content);

	const digest = checksum ?? createHash('sha256').update(content).digest('hex');
	writeFileSync(`${target}.sha256`, `${digest}  serendipeak-${stamp}.dump\n`);

	return key;
}

function stampAt(date) {
	return date
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d+Z$/, 'Z');
}

function recentStamp(minutesAgo = 5) {
	return stampAt(new Date(Date.now() - minutesAgo * 60_000));
}

function environmentFor(sandbox, overrides) {
	return {
		PATH: `${sandbox.bin}:/usr/bin:/bin`,
		TMPDIR: sandbox.scratch,
		STATE: sandbox.state,
		...baseEnv,
		...overrides
	};
}

function observe(sandbox, outcome) {
	const read = (name) => {
		const path = join(sandbox.state, name);
		return existsSync(path) ? readFileSync(path, 'utf8') : '';
	};
	const events = read('events.log').split('\n').filter(Boolean);

	return {
		...outcome,
		events,
		uploads: events.filter((line) => line.startsWith('upload ')).map((line) => line.slice(7)),
		pings: events.filter((line) => line.startsWith('ping ')).map((line) => line.slice(5)),
		argv: read('curl-argv.log'),
		leftoverTempEntries: readdirSync(sandbox.scratch)
	};
}

function runBackup(shell, args, env = {}, prepare = () => {}) {
	const sandbox = createSandbox();
	prepare(sandbox);

	const result = spawnSync(shell, [script, ...args], {
		env: environmentFor(sandbox, env),
		encoding: 'utf8',
		timeout: 30_000
	});

	return observe(sandbox, {
		status: result.status,
		signal: result.signal,
		stdout: result.stdout,
		stderr: result.stderr
	});
}

function assertSecretNeverExposed(result) {
	for (const surface of [result.stdout, result.stderr, result.argv]) {
		assert.ok(!surface.includes(TOKEN), 'the heartbeat token leaked');
		assert.ok(!surface.includes('heartbeat.test'), 'the heartbeat host leaked');
	}
}

for (const shell of shells) {
	describe(`backup.sh under ${shell}`, () => {
		describe('run', () => {
			test('succeeds without a heartbeat URL and reports nothing', () => {
				const result = runBackup(shell, ['run']);

				assert.equal(result.status, 0, result.stderr);
				assert.match(result.stdout, /backup ok: serendipeak-.*\.dump/);
				assert.match(result.stdout, /check ok: daily\/serendipeak-/);
				assert.equal(result.uploads.length, 2);
				assert.ok(result.uploads.every((key) => key.startsWith('daily/')));
				assert.deepEqual(result.pings, []);
				assert.deepEqual(result.leftoverTempEntries, []);
			});

			test('defaults to run when no argument is given', () => {
				const result = runBackup(shell, [], { BACKUP_HEARTBEAT_URL: HEARTBEAT });

				assert.equal(result.status, 0, result.stderr);
				assert.deepEqual(result.pings, [HEARTBEAT]);
			});

			test('sends one success heartbeat, last, and never /start', () => {
				const result = runBackup(shell, ['run'], { BACKUP_HEARTBEAT_URL: HEARTBEAT });

				assert.equal(result.status, 0, result.stderr);
				assert.deepEqual(result.pings, [HEARTBEAT]);
				assert.equal(result.events.at(-1), `ping ${HEARTBEAT}`);
				assert.ok(
					result.events.indexOf('pg_dump') < result.events.findIndex((e) => e.startsWith('upload '))
				);
				assert.ok(result.events.every((line) => !line.includes('/start')));
				assert.deepEqual(result.leftoverTempEntries, []);
				assertSecretNeverExposed(result);
			});

			test('normalizes a trailing slash', () => {
				const result = runBackup(shell, ['run'], { BACKUP_HEARTBEAT_URL: `${HEARTBEAT}/` });

				assert.deepEqual(result.pings, [HEARTBEAT]);
			});

			test('also keeps a weekly copy on Sundays', () => {
				const result = runBackup(shell, ['run'], {
					BACKUP_HEARTBEAT_URL: HEARTBEAT,
					FAKE_WEEKDAY: '7'
				});

				assert.equal(result.status, 0, result.stderr);
				assert.equal(result.uploads.filter((key) => key.startsWith('weekly/')).length, 2);
				assert.deepEqual(result.pings, [HEARTBEAT]);
			});

			test('treats an empty URL as not configured, without a warning', () => {
				const result = runBackup(shell, ['run'], { BACKUP_HEARTBEAT_URL: '' });

				assert.equal(result.status, 0, result.stderr);
				assert.deepEqual(result.pings, []);
				assert.ok(!result.stderr.includes('heartbeat'));
			});

			test('a dump failure reports /fail and keeps the exit code', () => {
				const result = runBackup(shell, ['run'], {
					BACKUP_HEARTBEAT_URL: HEARTBEAT,
					FAKE_PG_DUMP_EXIT: '3'
				});

				assert.equal(result.status, 3);
				assert.deepEqual(result.pings, [`${HEARTBEAT}/fail`]);
				assert.deepEqual(result.uploads, []);
				assert.deepEqual(result.leftoverTempEntries, []);
				assertSecretNeverExposed(result);
			});

			test('an unreadable archive stops before any upload', () => {
				const result = runBackup(shell, ['run'], {
					BACKUP_HEARTBEAT_URL: HEARTBEAT,
					FAKE_PG_RESTORE_EXIT: '1'
				});

				assert.equal(result.status, 1);
				assert.deepEqual(result.uploads, []);
				assert.deepEqual(result.pings, [`${HEARTBEAT}/fail`]);
			});

			test('a failed upload reports /fail', () => {
				const result = runBackup(shell, ['run'], {
					BACKUP_HEARTBEAT_URL: HEARTBEAT,
					FAKE_UPLOAD_EXIT: '55'
				});

				assert.equal(result.status, 55);
				assert.deepEqual(result.pings, [`${HEARTBEAT}/fail`]);
			});

			test('an upload of the wrong size reports /fail', () => {
				const result = runBackup(shell, ['run'], {
					BACKUP_HEARTBEAT_URL: HEARTBEAT,
					FAKE_SHORT_UPLOAD: '1'
				});

				assert.equal(result.status, 1);
				assert.match(result.stderr, /upload of daily\/.* bytes, expected/);
				assert.deepEqual(result.pings, [`${HEARTBEAT}/fail`]);
			});

			test('an uploaded dump that is not listable reports /fail, not success', () => {
				const result = runBackup(shell, ['run'], {
					BACKUP_HEARTBEAT_URL: HEARTBEAT,
					FAKE_LIST_EMPTY: '1'
				});

				assert.equal(result.status, 1);
				assert.match(result.stderr, /no daily backup found/);
				assert.deepEqual(result.pings, [`${HEARTBEAT}/fail`]);
			});

			test('an uploaded dump that fails its checksum reports /fail, not success', () => {
				const result = runBackup(shell, ['run'], {
					BACKUP_HEARTBEAT_URL: HEARTBEAT,
					FAKE_CORRUPT_DOWNLOAD: '1'
				});

				assert.notEqual(result.status, 0);
				assert.deepEqual(result.pings, [`${HEARTBEAT}/fail`]);
			});

			test('a newer dump that is not the one just uploaded cannot vouch for it', () => {
				const result = runBackup(shell, ['run'], { BACKUP_HEARTBEAT_URL: HEARTBEAT }, (sandbox) =>
					seedDump(sandbox, '29990101T000000Z')
				);

				assert.equal(result.status, 1);
				assert.match(result.stderr, /expected the one just uploaded/);
				assert.deepEqual(result.pings, [`${HEARTBEAT}/fail`]);
			});

			test('a missing setting fails early, reports /fail and names only the variable', () => {
				const result = runBackup(shell, ['run'], {
					BACKUP_HEARTBEAT_URL: HEARTBEAT,
					BACKUP_BUCKET: ''
				});

				assert.equal(result.status, 1);
				assert.match(result.stderr, /BACKUP_BUCKET is not set/);
				assert.deepEqual(result.pings, [`${HEARTBEAT}/fail`]);
				assert.deepEqual(result.uploads, []);
				assertSecretNeverExposed(result);
			});

			test('a missing database setting fails before dumping', () => {
				const result = runBackup(shell, ['run'], {
					BACKUP_HEARTBEAT_URL: HEARTBEAT,
					PGHOST: ''
				});

				assert.equal(result.status, 1);
				assert.match(result.stderr, /PGHOST is not set/);
				assert.ok(!result.events.includes('pg_dump'));
				assert.deepEqual(result.pings, [`${HEARTBEAT}/fail`]);
				assert.deepEqual(result.leftoverTempEntries, []);
			});

			test('a heartbeat that cannot be delivered does not fail a good backup', () => {
				const result = runBackup(shell, ['run'], {
					BACKUP_HEARTBEAT_URL: HEARTBEAT,
					FAKE_HEARTBEAT_EXIT: '7'
				});

				assert.equal(result.status, 0);
				assert.match(result.stderr, /heartbeat delivery failed \(curl exit 7\)/);
				assert.deepEqual(result.leftoverTempEntries, []);
				assertSecretNeverExposed(result);
			});

			test('a /fail that cannot be delivered keeps the original exit code', () => {
				const result = runBackup(shell, ['run'], {
					BACKUP_HEARTBEAT_URL: HEARTBEAT,
					FAKE_HEARTBEAT_EXIT: '7',
					FAKE_PG_DUMP_EXIT: '4'
				});

				assert.equal(result.status, 4);
				assert.match(result.stderr, /heartbeat delivery failed \(curl exit 7\)/);
				assertSecretNeverExposed(result);
			});

			for (const [label, url] of [
				['plain http', `http://heartbeat.test/${TOKEN}`],
				['a query string', `${HEARTBEAT}?x=1`],
				['a quote', `https://heartbeat.test/"${TOKEN}`],
				['whitespace', `https://heartbeat.test/${TOKEN} extra`],
				['no host', 'https:///path']
			]) {
				test(`skips a URL with ${label} and still completes the backup`, () => {
					const result = runBackup(shell, ['run'], { BACKUP_HEARTBEAT_URL: url });

					assert.equal(result.status, 0, result.stderr);
					assert.match(result.stderr, /heartbeat skipped: BACKUP_HEARTBEAT_URL/);
					assert.deepEqual(result.pings, []);
					assertSecretNeverExposed(result);
				});
			}

			test('SIGTERM during the dump exits 143, reports /fail and cleans up', async () => {
				const sandbox = createSandbox();
				const fifo = join(sandbox.root, 'release');
				const made = spawnSync('mkfifo', [fifo]);
				assert.equal(made.status, 0);

				const child = spawn(shell, [script, 'run'], {
					env: environmentFor(sandbox, {
						BACKUP_HEARTBEAT_URL: HEARTBEAT,
						FAKE_PG_DUMP_BLOCK_ON: fifo
					}),
					stdio: ['ignore', 'pipe', 'pipe']
				});
				const done = new Promise((resolve) =>
					child.on('close', (status, signal) => resolve({ status, signal }))
				);

				const started = join(sandbox.state, 'pg_dump.started');
				const deadline = Date.now() + 15_000;
				while (!existsSync(started)) {
					assert.ok(Date.now() < deadline, 'pg_dump never started');
					await new Promise((resolve) => setTimeout(resolve, 20));
				}

				// The shell runs a trap only once its foreground command returns, so the dump is
				// released after the signal is pending.
				child.kill('SIGTERM');
				writeFileSync(fifo, '');
				const { status, signal } = await done;
				const result = observe(sandbox, { status, signal });

				assert.equal(result.status, 143);
				assert.deepEqual(result.pings, [`${HEARTBEAT}/fail`]);
				assert.deepEqual(result.uploads, []);
				assert.deepEqual(result.leftoverTempEntries, []);
			});
		});

		describe('check', () => {
			test('passes on a recent intact dump and never reports', () => {
				const result = runBackup(shell, ['check'], { BACKUP_HEARTBEAT_URL: HEARTBEAT }, (sandbox) =>
					seedDump(sandbox, recentStamp())
				);

				assert.equal(result.status, 0, result.stderr);
				assert.match(result.stdout, /check ok: daily\/serendipeak-/);
				assert.deepEqual(result.pings, []);
				assert.deepEqual(result.leftoverTempEntries, []);
				assertSecretNeverExposed(result);
			});

			test('needs no database settings', () => {
				const result = runBackup(
					shell,
					['check'],
					{ PGHOST: '', PGUSER: '', PGPASSWORD: '', PGDATABASE: '' },
					(sandbox) => seedDump(sandbox, recentStamp())
				);

				assert.equal(result.status, 0, result.stderr);
			});

			test('fails without reporting when there is no backup', () => {
				const result = runBackup(shell, ['check'], { BACKUP_HEARTBEAT_URL: HEARTBEAT });

				assert.equal(result.status, 1);
				assert.match(result.stderr, /no daily backup found/);
				assert.deepEqual(result.pings, []);
				assert.ok(!result.argv.includes('heartbeat'));
			});

			test('fails without reporting when the newest backup is stale', () => {
				const result = runBackup(
					shell,
					['check'],
					{ BACKUP_HEARTBEAT_URL: HEARTBEAT, BACKUP_MAX_AGE_SECONDS: '3600' },
					(sandbox) => seedDump(sandbox, recentStamp(120))
				);

				assert.equal(result.status, 1);
				assert.match(result.stderr, /older than 3600s/);
				assert.deepEqual(result.pings, []);
			});

			test('fails without reporting when the checksum does not match', () => {
				const result = runBackup(shell, ['check'], { BACKUP_HEARTBEAT_URL: HEARTBEAT }, (sandbox) =>
					seedDump(sandbox, recentStamp(), { checksum: '0'.repeat(64) })
				);

				assert.notEqual(result.status, 0);
				assert.deepEqual(result.pings, []);
			});
		});

		describe('usage', () => {
			test('an unknown command exits 2 without reporting or needing configuration', () => {
				const result = runBackup(shell, ['prune'], {
					BACKUP_HEARTBEAT_URL: HEARTBEAT,
					BACKUP_BUCKET: ''
				});

				assert.equal(result.status, 2);
				assert.match(result.stderr, /usage: backup \[run\|check\]/);
				assert.deepEqual(result.pings, []);
			});
		});
	});
}
