import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { after, afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../offsite-backup.sh', import.meta.url));
const stubsDir = fileURLToPath(new URL('./stubs/', import.meta.url));

const TOKEN = 'SECRETTOKEN123';
const HEARTBEAT = `https://heartbeat.test/api/v1/heartbeat/${TOKEN}`;
const SECRETS = ['src-access-id', 'SRCSECRET456', 'dst-access-id', 'DSTSECRET789'];

const ORIGINALS = 'orig-bucket';
const PUBLIC = 'pub-bucket';
const BACKUP = 'backup-bucket';
const DESTINATION = 'dst-bucket';

// The container runs busybox ash; dash is the closest shell available on Linux CI, and the macOS
// `sh` is bash in POSIX mode, which handles traps and expansion errors differently.
const shells = ['sh', 'dash'].filter((shell) =>
	(process.env.PATH ?? '').split(delimiter).some((directory) => existsSync(join(directory, shell)))
);

const baseEnv = {
	OFFSITE_SRC_ENDPOINT_URL: 'https://r2.test',
	OFFSITE_SRC_ACCESS_KEY_ID: 'src-access-id',
	OFFSITE_SRC_SECRET_ACCESS_KEY: 'SRCSECRET456',
	OFFSITE_SRC_ORIGINALS_BUCKET: ORIGINALS,
	OFFSITE_SRC_PUBLIC_BUCKET: PUBLIC,
	OFFSITE_SRC_BACKUP_BUCKET: BACKUP,
	OFFSITE_DST_ENDPOINT_URL: 'https://s3.us-west-004.backblazeb2.com',
	OFFSITE_DST_REGION: 'us-west-004',
	OFFSITE_DST_ACCESS_KEY_ID: 'dst-access-id',
	OFFSITE_DST_SECRET_ACCESS_KEY: 'DSTSECRET789',
	OFFSITE_DST_BUCKET: DESTINATION,
	OFFSITE_RETRY_DELAY_SECONDS: '0'
};

const requiredVariables = Object.keys(baseEnv).filter((name) => name !== 'OFFSITE_RETRY_DELAY_SECONDS');

const sandboxes = [];

// The stubs keep no state (they read $STATE), so one copy serves every test. Fresh executables are
// scanned on first run on macOS, which made a copy per test cost seconds.
const sharedBin = mkdtempSync(join(tmpdir(), 'offsite-stubs-'));
for (const name of ['curl', 'date', 'rclone', 'sha256sum']) {
	copyFileSync(join(stubsDir, name), join(sharedBin, name));
	chmodSync(join(sharedBin, name), 0o755);
}

after(() => {
	rmSync(sharedBin, { recursive: true, force: true });
});

afterEach(() => {
	for (const sandbox of sandboxes.splice(0)) {
		rmSync(sandbox.root, { recursive: true, force: true });
	}
});

function createSandbox() {
	const root = mkdtempSync(join(tmpdir(), 'offsite-test-'));
	const sandbox = {
		root,
		bin: sharedBin,
		state: join(root, 'state'),
		scratch: join(root, 'scratch')
	};
	sandboxes.push(sandbox);

	for (const bucket of [ORIGINALS, PUBLIC, BACKUP]) {
		mkdirSync(join(sandbox.state, 'src', bucket), { recursive: true });
	}
	mkdirSync(join(sandbox.state, 'dst', DESTINATION), { recursive: true });
	mkdirSync(sandbox.scratch);

	return sandbox;
}

const sha256 = (content) => createHash('sha256').update(content).digest('hex');

function put(path, content) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

const sourcePath = (sandbox, bucket, key) => join(sandbox.state, 'src', bucket, key);
const offsitePath = (sandbox, name, key) => join(sandbox.state, 'dst', DESTINATION, name, key);

function seedOriginal(sandbox, content) {
	const digest = sha256(content);
	const key = `photographs/${digest}/original.jpg`;
	put(sourcePath(sandbox, ORIGINALS, key), content);

	return { digest, key, content };
}

function seedRendition(sandbox, original, name, content) {
	const key = `photographs/${original.digest}/${name}`;
	put(sourcePath(sandbox, PUBLIC, key), content);

	return { key, content };
}

function seedDump(sandbox, stamp, { content = 'a database dump\n', checksum, prefix = 'daily' } = {}) {
	const file = `serendipeak-${stamp}.dump`;
	const key = `${prefix}/${file}`;
	put(sourcePath(sandbox, BACKUP, key), content);
	put(sourcePath(sandbox, BACKUP, `${key}.sha256`), `${checksum ?? sha256(content)}  ${file}\n`);

	return { key, content };
}

function recentStamp(minutesAgo = 5) {
	return new Date(Date.now() - minutesAgo * 60_000)
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d+Z$/, 'Z');
}

// Two photographs with a page and a viewer rendition each, plus a daily and a weekly dump.
function seedProduction(sandbox) {
	const photographs = ['first photograph bytes', 'second photograph bytes'].map((content) => {
		const original = seedOriginal(sandbox, content);
		const renditions = [
			seedRendition(sandbox, original, 'page-r2.jpg', `page of ${content}`),
			seedRendition(sandbox, original, 'viewer-r2.jpg', `viewer of ${content}`)
		];
		return { original, renditions };
	});
	const stamp = recentStamp();
	const dumps = [seedDump(sandbox, stamp), seedDump(sandbox, stamp, { prefix: 'weekly' })];

	return { photographs, dumps };
}

function expectedManifest(production) {
	const entries = new Map();
	for (const { original, renditions } of production.photographs) {
		entries.set(`originals/${original.key}`, original.digest);
		for (const rendition of renditions) {
			entries.set(`media/${rendition.key}`, sha256(rendition.content));
		}
	}
	for (const dump of production.dumps) {
		entries.set(`db-backups/${dump.key}`, sha256(dump.content));
	}

	return entries;
}

function readManifest(sandbox) {
	const directory = join(sandbox.state, 'dst', DESTINATION, 'manifests');
	const names = existsSync(directory) ? readdirSync(directory).sort() : [];
	if (names.length === 0) {
		return null;
	}

	return new Map(
		readFileSync(join(directory, names.at(-1)), 'utf8')
			.split('\n')
			.filter(Boolean)
			.map((line) => {
				const [digest, path] = line.split('  ');
				return [path, digest];
			})
	);
}

function manifestNames(sandbox) {
	const directory = join(sandbox.state, 'dst', DESTINATION, 'manifests');
	return existsSync(directory) ? readdirSync(directory).sort() : [];
}

function corruptInPlace(path) {
	const content = readFileSync(path);
	content[0] = content[0] ^ 0xff;
	writeFileSync(path, content);
}

function environmentFor(sandbox, overrides) {
	return {
		PATH: `${sandbox.bin}:/usr/bin:/bin`,
		TMPDIR: sandbox.scratch,
		STATE: sandbox.state,
		FAKE_TICKING_CLOCK: join(sandbox.state, 'clock'),
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
	const argv = read('rclone-argv.log');

	return {
		...outcome,
		events,
		argv: `${argv}${read('curl-argv.log')}`,
		rcloneLines: argv.split('\n').filter(Boolean),
		verbs: [...new Set(events.filter((line) => line.startsWith('rclone ')).map((line) => line.slice(7)))],
		copies: events
			.filter((line) => line.startsWith('copied ') && !line.includes('/manifests/'))
			.map((line) => line.slice(7)),
		pings: events.filter((line) => line.startsWith('ping ')).map((line) => line.slice(5)),
		leftoverTempEntries: readdirSync(sandbox.scratch)
	};
}

function execute(shell, sandbox, args, env = {}) {
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

function runOffsite(shell, args, env = {}, prepare = () => {}) {
	const sandbox = createSandbox();
	const prepared = prepare(sandbox);

	return { ...execute(shell, sandbox, args, env), sandbox, prepared };
}

function assertSecretsNeverExposed(result) {
	for (const surface of [result.stdout, result.stderr, result.argv]) {
		for (const secret of [...SECRETS, TOKEN, 'heartbeat.test']) {
			assert.ok(!surface.includes(secret), `${secret} leaked`);
		}
	}
}

for (const shell of shells) {
	describe(`offsite-backup.sh under ${shell}`, () => {
		describe('run', () => {
			test('copies every object under its own key and records a checksum manifest', () => {
				const result = runOffsite(shell, ['run'], {}, seedProduction);
				const { sandbox, prepared } = result;

				assert.equal(result.status, 0, result.stderr);
				assert.match(result.stdout, /offsite ok: originals=2 media=4 db-backups=4 newly-verified=8/);

				for (const { original, renditions } of prepared.photographs) {
					assert.deepEqual(
						readFileSync(offsitePath(sandbox, 'originals', original.key)),
						readFileSync(sourcePath(sandbox, ORIGINALS, original.key))
					);
					for (const rendition of renditions) {
						assert.equal(
							readFileSync(offsitePath(sandbox, 'media', rendition.key), 'utf8'),
							rendition.content
						);
					}
				}
				for (const dump of prepared.dumps) {
					for (const key of [dump.key, `${dump.key}.sha256`]) {
						assert.deepEqual(
							readFileSync(offsitePath(sandbox, 'db-backups', key)),
							readFileSync(sourcePath(sandbox, BACKUP, key))
						);
					}
				}

				assert.deepEqual(readManifest(sandbox), expectedManifest(prepared));
				assert.deepEqual(result.pings, []);
				assert.deepEqual(result.leftoverTempEntries, []);
			});

			test('uses only read and copy verbs, never replaces an existing object, and hides credentials', () => {
				const result = runOffsite(shell, ['run'], {}, seedProduction);

				assert.equal(result.status, 0, result.stderr);
				assert.deepEqual(result.verbs.sort(), ['copy', 'copyto', 'hashsum', 'lsf']);

				const copyCalls = result.rcloneLines.filter((line) => /(^|\s)copy\s/.test(line));
				const uploads = copyCalls.filter((line) => /\sdst:\S+$/.test(line));
				assert.equal(uploads.length, 3);
				assert.ok(uploads.every((line) => line.includes('--ignore-existing')));
				assert.ok(result.rcloneLines.every((line) => !/(^|\s)copyto\s.*\sdst:/.test(line) || line.includes('--ignore-existing')));
				assertSecretsNeverExposed(result);
			});

			test('a repeat run transfers nothing and keeps the manifest complete', () => {
				const sandbox = createSandbox();
				const production = seedProduction(sandbox);

				const first = execute(shell, sandbox, ['run']);
				const second = execute(shell, sandbox, ['run']);

				assert.equal(first.status, 0, first.stderr);
				assert.equal(second.status, 0, second.stderr);
				assert.match(second.stdout, /newly-verified=0/);
				assert.equal(first.copies.length, 10);
				assert.deepEqual(second.copies, first.copies);
				assert.deepEqual(readManifest(sandbox), expectedManifest(production));
			});

			test('an incremental run copies and verifies only what is new', () => {
				const sandbox = createSandbox();
				const production = seedProduction(sandbox);
				execute(shell, sandbox, ['run']);

				const added = seedOriginal(sandbox, 'a third photograph');
				const page = seedRendition(sandbox, added, 'page-r2.jpg', 'page of the third');
				const before = execute(shell, sandbox, ['check']);
				assert.notEqual(before.status, 0, 'a new source object is not covered yet');

				const second = execute(shell, sandbox, ['run']);

				assert.equal(second.status, 0, second.stderr);
				assert.match(second.stdout, /originals=3 media=5 db-backups=4 newly-verified=2/);
				assert.deepEqual(readManifest(sandbox).get(`media/${page.key}`), sha256(page.content));
				assert.equal(readManifest(sandbox).size, expectedManifest(production).size + 2);
			});

			test('an object lost from the offsite bucket is copied again while the source still has it', () => {
				const sandbox = createSandbox();
				const production = seedProduction(sandbox);
				execute(shell, sandbox, ['run']);

				const lost = production.photographs[0].renditions[0];
				rmSync(offsitePath(sandbox, 'media', lost.key));
				const result = execute(shell, sandbox, ['run']);

				assert.equal(result.status, 0, result.stderr);
				assert.equal(readFileSync(offsitePath(sandbox, 'media', lost.key), 'utf8'), lost.content);
			});

			test('an object lost from both the offsite bucket and the source is a failure', () => {
				const sandbox = createSandbox();
				const production = seedProduction(sandbox);
				execute(shell, sandbox, ['run']);

				const original = production.photographs[0].original;
				rmSync(offsitePath(sandbox, 'originals', original.key));
				rmSync(sourcePath(sandbox, ORIGINALS, original.key));
				const result = execute(shell, sandbox, ['run'], { OFFSITE_HEARTBEAT_URL: HEARTBEAT });

				assert.equal(result.status, 1);
				assert.match(result.stderr, /originals: objects missing from the offsite bucket/);
				assert.ok(result.stderr.includes(original.key));
				assert.deepEqual(result.pings, [`${HEARTBEAT}/fail`]);
			});

			test('an empty source is not an error', () => {
				const result = runOffsite(shell, ['run']);

				assert.equal(result.status, 0, result.stderr);
				assert.match(result.stdout, /originals=0 media=0 db-backups=0 newly-verified=0/);
			});

			describe('transfers that go wrong', () => {
				test('an interrupted copy is retried and then completes', () => {
					const result = runOffsite(shell, ['run'], { FAKE_COPY_FAIL_FIRST: '2' }, seedProduction);

					assert.equal(result.status, 0, result.stderr);
					assert.match(result.stderr, /copy of originals failed \(attempt 1 of 3\), retrying/);
					assert.match(result.stderr, /copy of originals failed \(attempt 2 of 3\), retrying/);
					assert.deepEqual(readManifest(result.sandbox), expectedManifest(result.prepared));
				});

				test('a copy that keeps failing stops the run without a manifest', () => {
					const result = runOffsite(
						shell,
						['run'],
						{ FAKE_COPY_ALWAYS_FAIL: '1', OFFSITE_HEARTBEAT_URL: HEARTBEAT },
						seedProduction
					);

					assert.equal(result.status, 1);
					assert.match(result.stderr, /copy of originals failed after 3 attempts/);
					assert.equal(result.rcloneLines.filter((line) => /(^|\s)copy\s/.test(line)).length, 3);
					assert.deepEqual(manifestNames(result.sandbox), []);
					assert.deepEqual(result.pings, [`${HEARTBEAT}/fail`]);
				});

				test('the attempt limit is configurable', () => {
					const result = runOffsite(
						shell,
						['run'],
						{ FAKE_COPY_ALWAYS_FAIL: '1', OFFSITE_COPY_ATTEMPTS: '1' },
						seedProduction
					);

					assert.equal(result.status, 1);
					assert.match(result.stderr, /failed after 1 attempts/);
					assert.equal(result.rcloneLines.filter((line) => /(^|\s)copy\s/.test(line)).length, 1);
				});

				test('a silently truncated object is a failure, not a success', () => {
					const result = runOffsite(
						shell,
						['run'],
						{ FAKE_COPY_TRUNCATE: 'page-r2.jpg', OFFSITE_HEARTBEAT_URL: HEARTBEAT },
						seedProduction
					);

					assert.equal(result.status, 1);
					assert.match(result.stderr, /media: objects whose size differs from the source/);
					assert.deepEqual(manifestNames(result.sandbox), []);
					assert.deepEqual(result.pings, [`${HEARTBEAT}/fail`]);
				});

				test('an original that changes in transit fails its own SHA-256', () => {
					const result = runOffsite(
						shell,
						['run'],
						{ FAKE_COPY_FLIP: 'original.jpg', OFFSITE_HEARTBEAT_URL: HEARTBEAT },
						seedProduction
					);

					assert.equal(result.status, 1);
					assert.match(result.stderr, /originals: objects that are missing or do not match/);
					assert.deepEqual(manifestNames(result.sandbox), []);
					assert.deepEqual(result.pings, [`${HEARTBEAT}/fail`]);
				});

				test('a rendition that changes in transit differs from its source', () => {
					const result = runOffsite(shell, ['run'], { FAKE_COPY_FLIP: 'viewer-r2.jpg' }, seedProduction);

					assert.equal(result.status, 1);
					assert.match(result.stderr, /media: objects that are missing or do not match/);
					assert.deepEqual(manifestNames(result.sandbox), []);
				});
			});

			describe('objects already in the offsite bucket', () => {
				test('a different object under an existing key is neither replaced nor accepted', () => {
					const result = runOffsite(shell, ['run'], { OFFSITE_HEARTBEAT_URL: HEARTBEAT }, (sandbox) => {
						const production = seedProduction(sandbox);
						const { original } = production.photographs[0];
						const tampered = 'x'.repeat(original.content.length);
						put(offsitePath(sandbox, 'originals', original.key), tampered);
						return { original, tampered };
					});

					assert.equal(result.status, 1);
					assert.match(result.stderr, /originals: objects that are missing or do not match/);
					assert.ok(result.stderr.includes(result.prepared.original.key));
					assert.equal(
						readFileSync(offsitePath(result.sandbox, 'originals', result.prepared.original.key), 'utf8'),
						result.prepared.tampered
					);
					assert.deepEqual(manifestNames(result.sandbox), []);
					assert.deepEqual(result.pings, [`${HEARTBEAT}/fail`]);
				});

				test('an existing object of another size is neither replaced nor accepted', () => {
					const result = runOffsite(shell, ['run'], {}, (sandbox) => {
						const production = seedProduction(sandbox);
						const rendition = production.photographs[0].renditions[1];
						put(offsitePath(sandbox, 'media', rendition.key), 'short');
						return rendition;
					});

					assert.equal(result.status, 1);
					assert.match(result.stderr, /media: objects whose size differs from the source/);
					assert.equal(
						readFileSync(offsitePath(result.sandbox, 'media', result.prepared.key), 'utf8'),
						'short'
					);
				});

				test('an offsite rendition that the source no longer has cannot be verified', () => {
					const result = runOffsite(shell, ['run'], {}, (sandbox) => {
						const production = seedProduction(sandbox);
						const original = production.photographs[0].original;
						put(offsitePath(sandbox, 'media', `photographs/${original.digest}/page-r1.jpg`), 'old');
					});

					assert.equal(result.status, 1);
					assert.match(result.stderr, /offsite objects absent from the source/);
				});

				test('an offsite-only object stays untouched and is not counted against the source', () => {
					const sandbox = createSandbox();
					const production = seedProduction(sandbox);
					execute(shell, sandbox, ['run']);

					const original = production.photographs[1].original;
					rmSync(sourcePath(sandbox, ORIGINALS, original.key));
					const result = execute(shell, sandbox, ['run']);

					assert.equal(result.status, 0, result.stderr);
					assert.ok(existsSync(offsitePath(sandbox, 'originals', original.key)));
					assert.deepEqual(readManifest(sandbox), expectedManifest(production));
				});
			});

			describe('original photographs', () => {
				test('a key that does not carry its own SHA-256 is rejected', () => {
					const result = runOffsite(shell, ['run'], {}, (sandbox) => {
						put(sourcePath(sandbox, ORIGINALS, 'photographs/not-a-digest/original.jpg'), 'bytes');
					});

					assert.equal(result.status, 1);
					assert.match(result.stderr, /originals: keys that are not content-addressed/);
				});

				test('bytes stored under the wrong digest are rejected', () => {
					const result = runOffsite(shell, ['run'], {}, (sandbox) => {
						put(sourcePath(sandbox, ORIGINALS, `photographs/${'a'.repeat(64)}/original.jpg`), 'bytes');
					});

					assert.equal(result.status, 1);
					assert.match(result.stderr, /originals: objects that are missing or do not match/);
				});
			});

			describe('database dumps', () => {
				test('keeps the checksum file byte for byte next to its dump', () => {
					const result = runOffsite(shell, ['run'], {}, seedProduction);
					const dump = result.prepared.dumps[0];

					assert.equal(
						readFileSync(offsitePath(result.sandbox, 'db-backups', `${dump.key}.sha256`), 'utf8'),
						`${sha256(dump.content)}  ${dump.key.split('/')[1]}\n`
					);
				});

				test('a dump without its checksum file is a failure', () => {
					const result = runOffsite(shell, ['run'], {}, (sandbox) => {
						const dump = seedDump(sandbox, recentStamp());
						rmSync(sourcePath(sandbox, BACKUP, `${dump.key}.sha256`));
					});

					assert.equal(result.status, 1);
					assert.match(result.stderr, /db-backups: dumps and checksum files that do not pair up/);
				});

				test('a dump that does not match its checksum is a failure', () => {
					const result = runOffsite(shell, ['run'], {}, (sandbox) => {
						seedDump(sandbox, recentStamp(), { checksum: '0'.repeat(64) });
					});

					assert.equal(result.status, 1);
					assert.match(result.stderr, /db-backups: objects that are missing or do not match/);
					assert.deepEqual(manifestNames(result.sandbox), []);
				});

				test('a checksum file that names another file is a failure', () => {
					const result = runOffsite(shell, ['run'], {}, (sandbox) => {
						const dump = seedDump(sandbox, recentStamp());
						put(
							sourcePath(sandbox, BACKUP, `${dump.key}.sha256`),
							`${sha256(dump.content)}  serendipeak-other.dump\n`
						);
					});

					assert.equal(result.status, 1);
					assert.match(result.stderr, /checksum files that are malformed or name another file/);
				});

				test('a malformed checksum file is a failure', () => {
					const result = runOffsite(shell, ['run'], {}, (sandbox) => {
						const dump = seedDump(sandbox, recentStamp());
						put(sourcePath(sandbox, BACKUP, `${dump.key}.sha256`), 'not a checksum\n');
					});

					assert.equal(result.status, 1);
					assert.match(result.stderr, /checksum files that are malformed or name another file/);
				});
			});

			describe('failures of the storage tooling', () => {
				for (const [label, env, expected] of [
					['listing the source', { FAKE_LSF_SRC_EXIT: '4' }, /listing src:orig-bucket failed \(rclone exit 4\)/],
					['listing the offsite bucket', { FAKE_LSF_DST_EXIT: '4' }, /listing dst:dst-bucket\/originals failed/],
					['hashing', { FAKE_HASH_EXIT: '5' }, /hashing objects under .* failed/]
				]) {
					test(`${label} failing is a failure that reports /fail`, () => {
						const result = runOffsite(
							shell,
							['run'],
							{ ...env, OFFSITE_HEARTBEAT_URL: HEARTBEAT },
							seedProduction
						);

						assert.equal(result.status, 1);
						assert.match(result.stderr, expected);
						assert.deepEqual(manifestNames(result.sandbox), []);
						assert.deepEqual(result.pings, [`${HEARTBEAT}/fail`]);
						assertSecretsNeverExposed(result);
					});
				}

				test('a manifest that does not read back as written is a failure', () => {
					const result = runOffsite(shell, ['run'], { FAKE_MANIFEST_READBACK_CORRUPT: '1' }, seedProduction);

					assert.equal(result.status, 1);
					assert.match(result.stderr, /does not read back as written/);
				});

				test('a malformed previous manifest stops the run', () => {
					const result = runOffsite(shell, ['run'], {}, (sandbox) => {
						seedProduction(sandbox);
						put(offsitePath(sandbox, 'manifests', 'offsite-20200101T000000Z.sha256'), 'garbage\n');
					});

					assert.equal(result.status, 1);
					assert.match(result.stderr, /has malformed lines/);
				});
			});

			describe('configuration', () => {
				for (const variable of requiredVariables) {
					test(`${variable} missing fails early, reports /fail and touches no storage`, () => {
						const result = runOffsite(shell, ['run'], {
							[variable]: '',
							OFFSITE_HEARTBEAT_URL: HEARTBEAT
						});

						assert.equal(result.status, 1);
						assert.match(result.stderr, new RegExp(`${variable} is not set`));
						assert.deepEqual(result.verbs, []);
						assert.deepEqual(result.pings, [`${HEARTBEAT}/fail`]);
						assert.deepEqual(result.leftoverTempEntries, []);
						assertSecretsNeverExposed(result);
					});
				}

				test('a value with a line break cannot add lines to the rclone configuration', () => {
					const result = runOffsite(shell, ['run'], {
						OFFSITE_DST_REGION: 'us-west-004\nsecret_access_key = stolen'
					});

					assert.equal(result.status, 1);
					assert.match(result.stderr, /OFFSITE_DST_REGION contains a line break/);
					assert.deepEqual(result.verbs, []);
				});

				test('a bucket name with other characters is rejected', () => {
					const result = runOffsite(shell, ['run'], { OFFSITE_DST_BUCKET: 'bucket/../other' });

					assert.equal(result.status, 1);
					assert.match(result.stderr, /OFFSITE_DST_BUCKET is not a bucket name/);
				});

				for (const variable of ['OFFSITE_SRC_ENDPOINT_URL', 'OFFSITE_DST_ENDPOINT_URL']) {
					for (const [label, endpoint] of [
						['no scheme', 's3.us-east-005.backblazeb2.com'],
						['plain http', 'http://s3.us-east-005.backblazeb2.com'],
						['another scheme', 'ftp://s3.us-east-005.backblazeb2.com'],
						['an upper-case scheme', 'HTTPS://s3.us-east-005.backblazeb2.com'],
						['no host', 'https://'],
						['a path', 'https://s3.us-east-005.backblazeb2.com/bucket'],
						['a trailing slash', 'https://s3.us-east-005.backblazeb2.com/'],
						['a query string', 'https://s3.us-east-005.backblazeb2.com?x=1'],
						['user info', 'https://id:SECRETUSERINFO@s3.us-east-005.backblazeb2.com'],
						['whitespace', 'https://s3.us-east-005.backblazeb2.com extra'],
						['a quote', 'https://s3.us-east-005.backblazeb2.com"']
					]) {
						test(`${variable} with ${label} is rejected before any storage call, without echoing it`, () => {
							const result = runOffsite(
								shell,
								['run'],
								{ [variable]: endpoint, OFFSITE_HEARTBEAT_URL: HEARTBEAT },
								seedProduction
							);

							assert.equal(result.status, 1);
							assert.match(result.stderr, new RegExp(`${variable} must be an https:// URL`));
							assert.ok(!result.stderr.includes('SECRETUSERINFO'));
							assert.ok(!result.stderr.includes('us-east-005'), 'the rejected value was echoed');
							assert.deepEqual(result.verbs, []);
							assert.deepEqual(result.pings, [`${HEARTBEAT}/fail`]);
							assert.deepEqual(result.leftoverTempEntries, []);
							assertSecretsNeverExposed(result);
						});
					}

					test(`${variable} accepts a host with a port`, () => {
						const result = runOffsite(shell, ['run'], { [variable]: 'https://storage.test:9000' });

						assert.equal(result.status, 0, result.stderr);
					});
				}

				test('check and deep-check apply the same endpoint validation', () => {
					for (const command of ['check', 'deep-check']) {
						const result = runOffsite(shell, [command], {
							OFFSITE_DST_ENDPOINT_URL: 'http://s3.us-east-005.backblazeb2.com'
						});

						assert.equal(result.status, 1);
						assert.match(result.stderr, /OFFSITE_DST_ENDPOINT_URL must be an https:\/\/ URL/);
						assert.deepEqual(result.verbs, []);
					}
				});

				test('a setting that is not a number is rejected', () => {
					const result = runOffsite(shell, ['run'], { OFFSITE_COPY_ATTEMPTS: 'three' });

					assert.equal(result.status, 1);
					assert.match(result.stderr, /COPY_ATTEMPTS is not a number/);
				});

				test('the database job heartbeat is not used by this job', () => {
					const result = runOffsite(
						shell,
						['run'],
						{ BACKUP_HEARTBEAT_URL: HEARTBEAT },
						seedProduction
					);

					assert.equal(result.status, 0, result.stderr);
					assert.deepEqual(result.pings, []);
				});
			});

			describe('heartbeat', () => {
				test('sends one success ping, last, and never /start', () => {
					const result = runOffsite(shell, ['run'], { OFFSITE_HEARTBEAT_URL: HEARTBEAT }, seedProduction);

					assert.equal(result.status, 0, result.stderr);
					assert.deepEqual(result.pings, [HEARTBEAT]);
					assert.equal(result.events.at(-1), `ping ${HEARTBEAT}`);
					assert.ok(result.events.every((line) => !line.includes('/start')));
					assert.deepEqual(result.leftoverTempEntries, []);
					assertSecretsNeverExposed(result);
				});

				test('normalizes a trailing slash', () => {
					const result = runOffsite(shell, ['run'], { OFFSITE_HEARTBEAT_URL: `${HEARTBEAT}/` });

					assert.deepEqual(result.pings, [HEARTBEAT]);
				});

				test('defaults to run when no argument is given', () => {
					const sandbox = createSandbox();
					const result = execute(shell, sandbox, [], { OFFSITE_HEARTBEAT_URL: HEARTBEAT });

					assert.equal(result.status, 0, result.stderr);
					assert.deepEqual(result.pings, [HEARTBEAT]);
				});

				test('treats an empty URL as not configured, without a warning', () => {
					const result = runOffsite(shell, ['run'], { OFFSITE_HEARTBEAT_URL: '' });

					assert.equal(result.status, 0, result.stderr);
					assert.deepEqual(result.pings, []);
					assert.ok(!result.stderr.includes('heartbeat'));
				});

				test('a heartbeat that cannot be delivered does not fail a good copy', () => {
					const result = runOffsite(
						shell,
						['run'],
						{ OFFSITE_HEARTBEAT_URL: HEARTBEAT, FAKE_HEARTBEAT_EXIT: '7' },
						seedProduction
					);

					assert.equal(result.status, 0);
					assert.match(result.stderr, /heartbeat delivery failed \(curl exit 7\)/);
					assertSecretsNeverExposed(result);
				});

				test('a /fail that cannot be delivered keeps the original exit code', () => {
					const result = runOffsite(
						shell,
						['run'],
						{ OFFSITE_HEARTBEAT_URL: HEARTBEAT, FAKE_HEARTBEAT_EXIT: '7', FAKE_COPY_ALWAYS_FAIL: '1' },
						seedProduction
					);

					assert.equal(result.status, 1);
					assert.match(result.stderr, /heartbeat delivery failed \(curl exit 7\)/);
					assertSecretsNeverExposed(result);
				});

				for (const [label, url] of [
					['plain http', `http://heartbeat.test/${TOKEN}`],
					['a query string', `${HEARTBEAT}?x=1`],
					['a quote', `https://heartbeat.test/"${TOKEN}`],
					['whitespace', `https://heartbeat.test/${TOKEN} extra`],
					['no host', 'https:///path']
				]) {
					test(`skips a URL with ${label} and still completes the copy`, () => {
						const result = runOffsite(shell, ['run'], { OFFSITE_HEARTBEAT_URL: url });

						assert.equal(result.status, 0, result.stderr);
						assert.match(result.stderr, /heartbeat skipped: OFFSITE_HEARTBEAT_URL/);
						assert.deepEqual(result.pings, []);
						assertSecretsNeverExposed(result);
					});
				}
			});
		});

		describe('check', () => {
			function completedRun() {
				const sandbox = createSandbox();
				const production = seedProduction(sandbox);
				const first = execute(shell, sandbox, ['run']);
				assert.equal(first.status, 0, first.stderr);

				return { sandbox, production };
			}

			test('passes after a complete run and never reports', () => {
				const { sandbox } = completedRun();
				const result = execute(shell, sandbox, ['check'], { OFFSITE_HEARTBEAT_URL: HEARTBEAT });

				assert.equal(result.status, 0, result.stderr);
				assert.match(result.stdout, /check ok: offsite-.*\.sha256, daily\/serendipeak-/);
				assert.deepEqual(result.pings, []);
				assert.deepEqual(result.leftoverTempEntries, []);
				assertSecretsNeverExposed(result);
			});

			test('fails when no run ever completed', () => {
				const result = runOffsite(shell, ['check'], { OFFSITE_HEARTBEAT_URL: HEARTBEAT }, seedProduction);

				assert.equal(result.status, 1);
				assert.match(result.stderr, /no manifest found/);
				assert.deepEqual(result.pings, []);
			});

			test('fails when the newest manifest is stale', () => {
				const { sandbox } = completedRun();
				const directory = join(sandbox.state, 'dst', DESTINATION, 'manifests');
				const [name] = readdirSync(directory);
				renameSync(join(directory, name), join(directory, 'offsite-20200101T000000Z.sha256'));

				const result = execute(shell, sandbox, ['check'], { OFFSITE_MAX_AGE_SECONDS: '3600' });

				assert.equal(result.status, 1);
				assert.match(result.stderr, /older than 3600s/);
			});

			test('fails when an object is missing from the offsite bucket', () => {
				const { sandbox, production } = completedRun();
				const { original } = production.photographs[0];
				rmSync(offsitePath(sandbox, 'originals', original.key));
				rmSync(sourcePath(sandbox, ORIGINALS, original.key));

				const result = execute(shell, sandbox, ['check']);

				assert.equal(result.status, 1);
				assert.match(result.stderr, /originals: objects missing from the offsite bucket/);
			});

			test('fails when the source has an object the offsite bucket lacks', () => {
				const { sandbox } = completedRun();
				seedOriginal(sandbox, 'uploaded after the last run');

				const result = execute(shell, sandbox, ['check']);

				assert.equal(result.status, 1);
				assert.match(result.stderr, /objects missing from the offsite bucket/);
			});

			test('fails when the newest daily dump no longer matches its checksum', () => {
				const { sandbox, production } = completedRun();
				const dump = production.dumps[0];
				corruptInPlace(offsitePath(sandbox, 'db-backups', dump.key));

				const result = execute(shell, sandbox, ['check']);

				assert.equal(result.status, 1);
				assert.match(result.stderr, /db-backups: objects that are missing or do not match/);
			});
		});

		describe('deep-check', () => {
			function completedRun() {
				const sandbox = createSandbox();
				const production = seedProduction(sandbox);
				const first = execute(shell, sandbox, ['run']);
				assert.equal(first.status, 0, first.stderr);

				return { sandbox, production };
			}

			test('passes when every object still matches the manifest, and never reports', () => {
				const { sandbox, production } = completedRun();
				const result = execute(shell, sandbox, ['deep-check'], { OFFSITE_HEARTBEAT_URL: HEARTBEAT });

				assert.equal(result.status, 0, result.stderr);
				assert.match(
					result.stdout,
					new RegExp(`deep-check ok: ${expectedManifest(production).size} objects match`)
				);
				assert.deepEqual(result.pings, []);
				assert.deepEqual(result.leftoverTempEntries, []);
			});

			test('catches a rendition corrupted at rest without changing its size', () => {
				const { sandbox, production } = completedRun();
				const rendition = production.photographs[1].renditions[0];
				corruptInPlace(offsitePath(sandbox, 'media', rendition.key));

				const quick = execute(shell, sandbox, ['run']);
				const deep = execute(shell, sandbox, ['deep-check']);

				assert.equal(quick.status, 0, 'a verified object is not re-read by `run`');
				assert.equal(deep.status, 1);
				assert.match(deep.stderr, /media: objects that are missing or do not match/);
				assert.ok(deep.stderr.includes(rendition.key));
			});

			test('catches an original corrupted at rest', () => {
				const { sandbox, production } = completedRun();
				const { original } = production.photographs[0];
				corruptInPlace(offsitePath(sandbox, 'originals', original.key));

				const result = execute(shell, sandbox, ['deep-check']);

				assert.equal(result.status, 1);
				assert.match(result.stderr, /originals: objects that are missing or do not match/);
			});

			test('catches a dump corrupted at rest', () => {
				const { sandbox, production } = completedRun();
				corruptInPlace(offsitePath(sandbox, 'db-backups', production.dumps[1].key));

				const result = execute(shell, sandbox, ['deep-check']);

				assert.equal(result.status, 1);
				assert.match(result.stderr, /db-backups: objects that are missing or do not match/);
			});

			test('fails without a manifest', () => {
				const result = runOffsite(shell, ['deep-check'], {}, seedProduction);

				assert.equal(result.status, 1);
				assert.match(result.stderr, /no manifest found/);
			});
		});

		describe('usage', () => {
			test('an unknown command exits 2 without reporting or needing configuration', () => {
				const result = runOffsite(shell, ['sync'], {
					OFFSITE_HEARTBEAT_URL: HEARTBEAT,
					OFFSITE_DST_BUCKET: ''
				});

				assert.equal(result.status, 2);
				assert.match(result.stderr, /usage: offsite-backup \[run\|check\|deep-check\]/);
				assert.deepEqual(result.pings, []);
				assert.deepEqual(result.verbs, []);
			});
		});
	});
}
