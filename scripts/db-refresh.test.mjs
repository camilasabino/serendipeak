import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	LocalPostgres,
	READ_ONLY_OPTIONS,
	RefreshError,
	acquireLock,
	assertDistinctServers,
	assertOperatorFile,
	assertReadOnlyCommand,
	assertSourceIdentity,
	createExec,
	extractContentSha,
	isRefreshBackup,
	makeRedactor,
	parseDatabaseUrl,
	parseEnv,
	readSourceConfig,
	readTargetConfig,
	refresh,
	refreshNames,
	swapDatabases,
	tail,
} from './db-refresh.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/db-refresh.mjs');
const scratch = () => mkdtempSync(join(tmpdir(), 'db-refresh-test-'));

describe('configuration guards', () => {
	test('parseEnv reads plain, quoted, exported and commented values', () => {
		const values = parseEnv(
			['# comment', '', 'A=1', 'export B="two words"', "C='x'", 'D=value # trailing', 'BAD'].join(
				'\n'
			)
		);

		assert.deepEqual(values, { A: '1', B: 'two words', C: 'x', D: 'value' });
	});

	test('a database URL must be local, explicit and well named', () => {
		const ok = parseDatabaseUrl('postgres://u:p%40ss@127.0.0.1:5434/serendipeak', 'x');
		assert.equal(ok.name, 'serendipeak');
		assert.equal(ok.port, 5434);
		assert.equal(ok.password, 'p@ss');

		for (const bad of [
			'',
			'mysql://u:p@127.0.0.1:5434/db',
			'postgres://u:p@db.example.com:5434/db',
			'postgres://u:p@127.0.0.1/db',
			'postgres://u:p@127.0.0.1:5434/Bad-Name',
			'postgres://u:p@127.0.0.1:5434/',
		]) {
			assert.throws(() => parseDatabaseUrl(bad, 'x'), RefreshError, bad);
		}
	});

	test('the source must be marked production and the destination development', () => {
		const url = 'postgres://u:p@127.0.0.1:54329/serendipeak';

		assert.throws(
			() => readSourceConfig({ APP_ENV: 'development', DATABASE_URL: url }),
			/APP_ENV=production/
		);
		assert.equal(readSourceConfig({ APP_ENV: 'production', DATABASE_URL: url }).port, 54329);

		const local = 'postgres://u:p@localhost:5434/serendipeak';
		assert.throws(
			() => readTargetConfig({ APP_ENV: 'production', DATABASE_URL: local }, 5434),
			/APP_ENV=development/
		);
		assert.throws(
			() => readTargetConfig({ APP_ENV: 'development', DATABASE_URL: local }, 5999),
			/published on 5999/
		);
		assert.equal(
			readTargetConfig({ APP_ENV: 'development', DATABASE_URL: local }, 5434).name,
			'serendipeak'
		);
	});

	test('source and destination may not share a port', () => {
		assert.throws(() => assertDistinctServers({ port: 5434 }, { port: 5434 }), /same local port/);
		assertDistinctServers({ port: 54329 }, { port: 5434 });
	});

	test('the operator file must be absolute, private and outside the repository', () => {
		const repository = scratch();
		const outside = scratch();
		try {
			const inside = join(repository, 'operator.env');
			const fine = join(outside, 'operator.env');
			writeFileSync(inside, 'A=1\n', { mode: 0o600 });
			writeFileSync(fine, 'A=1\n', { mode: 0o600 });

			assert.throws(() => assertOperatorFile(undefined, repository), /Set OPERATOR_ENV/);
			assert.throws(() => assertOperatorFile('operator.env', repository), /absolute path/);
			assert.throws(
				() => assertOperatorFile(join(outside, 'missing'), repository),
				/existing file/
			);
			assert.throws(() => assertOperatorFile(inside, repository), /outside the repository/);

			chmodSync(fine, 0o644);
			assert.throws(() => assertOperatorFile(fine, repository), /chmod 600/);

			chmodSync(fine, 0o600);
			assert.equal(assertOperatorFile(fine, repository), join(realpath(outside), 'operator.env'));
		} finally {
			rmSync(repository, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});

	test('only the export and the identity probe may run against production', () => {
		assertReadOnlyCommand(['export_catalog_snapshot', '--output', '/tmp/x.json']);

		for (const args of [
			['migrate', '--noinput'],
			['load_catalog_snapshot', '--input', 'x', '--sha256', 'y'],
			['create_editor', 'someone'],
			[
				'shell',
				'-c',
				'from django.db import connection; connection.cursor().execute("drop table mountain")',
			],
			['export_catalog_snapshot', '--output', '/tmp/x.json', '--include-discoveries'],
			['export_catalog_snapshot'],
			[],
		]) {
			assert.throws(() => assertReadOnlyCommand(args), RefreshError, JSON.stringify(args));
		}
	});

	test('production sessions are read-only', () => {
		assert.match(READ_ONLY_OPTIONS, /default_transaction_read_only=on/);
	});

	test('the source identity must match, be read-only and be another cluster', () => {
		const source = { name: 'serendipeak' };
		const probe = { database: 'serendipeak', readOnly: 'on', system: '111' };

		assertSourceIdentity(probe, source, '222');
		assert.throws(
			() => assertSourceIdentity({ ...probe, database: 'other' }, source, '222'),
			/expected "serendipeak"/
		);
		assert.throws(
			() => assertSourceIdentity({ ...probe, readOnly: 'off' }, source, '222'),
			/not read-only/
		);
		assert.throws(() => assertSourceIdentity(probe, source, '111'), /same PostgreSQL cluster/);
	});
});

describe('helpers', () => {
	test('names are derived from the live database and recognised as backups', () => {
		const names = refreshNames('serendipeak', new Date('2026-11-11T21:35:43.123Z'));

		assert.equal(names.stamp, '20261111t213543');
		assert.equal(names.candidate, 'serendipeak_refresh_20261111t213543');
		assert.equal(names.backup, 'serendipeak_pre_refresh_20261111t213543');
		assert.ok(isRefreshBackup('serendipeak', names.backup));
		assert.ok(!isRefreshBackup('serendipeak', 'serendipeak_pre_aq3b'));
		assert.ok(!isRefreshBackup('serendipeak', 'serendipeak_pre_refresh_latest'));
		assert.ok(!isRefreshBackup('serendipeak', 'other_pre_refresh_20261111t213543'));
	});

	test('the content checksum is read from the export report', () => {
		const sha = 'a'.repeat(64);

		assert.equal(extractContentSha(`Wrote x\ncontent_sha256: ${sha}\n`), sha);
		assert.throws(() => extractContentSha('Wrote x\n'), RefreshError);
	});

	test('the redactor hides long secrets and URL passwords, and ignores short ones', () => {
		const redact = makeRedactor(
			{
				values: { DATABASE_URL: 'postgres://u:Sup3rS3cretPw@127.0.0.1:1/db', NAME: 'visible' },
				minimumLength: 8,
			},
			{ values: { DJANGO_SECRET_KEY: 'short' }, minimumLength: 12 }
		);

		const out = redact('x Sup3rS3cretPw y postgres://u:Sup3rS3cretPw@127.0.0.1:1/db short visible');
		assert.equal(out, 'x *** y *** short visible');
	});

	test('tail keeps the last lines', () => {
		assert.equal(tail('a\nb\nc\nd', 2), 'c\nd');
	});

	test('the lock admits one run at a time and reclaims an abandoned one', async () => {
		const directory = join(scratch(), 'lock');
		try {
			const release = await acquireLock(directory);
			await assert.rejects(acquireLock(directory), /Another refresh is running/);

			release();
			assert.ok(!existsSync(directory));

			mkdirSync(directory);
			writeFileSync(join(directory, 'pid'), '2147483646');
			const again = await acquireLock(directory);
			again();
		} finally {
			rmSync(join(directory, '..'), { recursive: true, force: true });
		}
	});
});

function realpath(path) {
	return execFileSync('node', ['-p', `require('fs').realpathSync(${JSON.stringify(path)})`], {
		encoding: 'utf8',
	}).trim();
}

// The integration tests need the local PostGIS container, uv and a populated local database. They
// create their own disposable databases and a throwaway second PostgreSQL cluster that plays
// production; the real local database is only read, to seed the copies.
const integration = process.env.DB_REFRESH_INTEGRATION === '1';

describe(
	'against disposable databases',
	{ skip: !integration && 'set DB_REFRESH_INTEGRATION=1' },
	() => {
		const suffix = `${process.pid}`;
		const sourceContainer = `serendipeak-refresh-test-source-${suffix}`;
		const sourceDatabases = [`rt_source_${suffix}`, `rt_bad_${suffix}`];
		const lives = [];
		let sourcePort;
		let localContainer;
		let seedDatabase;
		let directory;
		let targetEnvTemplate;
		let operatorFile;

		const docker = (...args) =>
			execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
		const sql = (container, database, statement) =>
			docker(
				'exec',
				container,
				'psql',
				'-U',
				'serendipeak',
				'-d',
				database,
				'-Atc',
				statement
			).trim();
		const clone = (fromContainer, from, toContainer, to) => {
			docker(
				'exec',
				toContainer,
				'psql',
				'-U',
				'serendipeak',
				'-d',
				'postgres',
				'-Atc',
				`create database "${to}" template template0`
			);
			execFileSync(
				'sh',
				[
					'-c',
					`docker exec ${fromContainer} pg_dump -U serendipeak -d ${from} --no-owner | docker exec -i ${toContainer} psql -U serendipeak -d ${to} -X -q -v ON_ERROR_STOP=1 >/dev/null`,
				],
				{ stdio: 'pipe' }
			);
		};
		const databases = () =>
			sql(
				localContainer,
				'postgres',
				"select datname from pg_database where datname like 'rt_live_%' order by 1"
			)
				.split('\n')
				.filter(Boolean);

		function freePort() {
			return new Promise((resolve) => {
				const server = net.createServer().listen(0, '127.0.0.1', () => {
					const { port } = server.address();
					server.close(() => resolve(port));
				});
			});
		}

		function writeEnv(file, values) {
			writeFileSync(
				file,
				Object.entries(values)
					.map(([key, value]) => `${key}=${value}`)
					.join('\n') + '\n',
				{ mode: 0o600 }
			);
			chmodSync(file, 0o600);
			return file;
		}

		function operatorEnv(database, port = sourcePort) {
			return writeEnv(join(directory, `operator-${database}-${port}.env`), {
				...Object.fromEntries(
					Object.entries(targetEnvTemplate).filter(([key]) =>
						['GDAL_LIBRARY_PATH', 'GEOS_LIBRARY_PATH'].includes(key)
					)
				),
				APP_ENV: 'production',
				ALLOWED_HOSTS: 'localhost',
				CORS_ALLOWED_ORIGIN: 'https://example.test',
				WEB_ORIGIN: 'https://example.test',
				TRUSTED_PROXY_HOPS: '1',
				DJANGO_SECRET_KEY: 'test-secret-key-for-the-operator-file-only',
				PREVIEW_SIGNING_KEY: 'test-signing-key-for-the-operator-file-only',
				MEDIA_STORE: 's3',
				MEDIA_PUBLIC_BASE_URL: 'https://media.example.test',
				MEDIA_S3_ENDPOINT_URL: 'https://example.invalid',
				MEDIA_S3_ACCESS_KEY_ID: 'dummy',
				MEDIA_S3_SECRET_ACCESS_KEY: 'dummy-secret',
				MEDIA_PUBLIC_BUCKET: 'x',
				MEDIA_ORIGINALS_BUCKET: 'y',
				DATABASE_URL: `postgres://serendipeak:rehearsal-source-pw@127.0.0.1:${port}/${database}`,
			});
		}

		function targetEnv(live) {
			const url = new URL(targetEnvTemplate.DATABASE_URL);
			url.pathname = `/${live}`;

			return writeEnv(join(directory, `target-${live}.env`), {
				...targetEnvTemplate,
				DATABASE_URL: url.toString(),
				MEDIA_STORE: 'filesystem',
				MEDIA_ROOT: '.media',
				MEDIA_PUBLIC_BASE_URL: 'http://localhost:8000/media',
			});
		}

		function newLive(label) {
			const name = `rt_live_${suffix}_${label}`;
			clone(localContainer, seedDatabase, localContainer, name);
			sql(
				localContainer,
				name,
				"insert into app_user (id, password, last_login, username, role, is_active) select gen_random_uuid(), password, last_login, 'rehearsal-' || '" +
					label +
					"', role, is_active from app_user limit 1"
			);
			lives.push(name);
			return { name, envFile: targetEnv(name) };
		}

		function run(args, { env = {}, onLine } = {}) {
			return new Promise((resolve) => {
				const child = spawn('node', [SCRIPT, ...args], {
					cwd: ROOT,
					env: { ...process.env, OPERATOR_ENV: operatorFile, ...env },
				});
				let output = '';
				const collect = (chunk) => {
					output += chunk;
					onLine?.(child, output);
				};
				child.stdout.on('data', collect);
				child.stderr.on('data', collect);
				child.on('close', (code) => resolve({ code, output }));
			});
		}

		const mountainCount = (db) => Number(sql(localContainer, db, 'select count(*) from mountain'));
		const snapshotDirectories = () =>
			readdirSync(tmpdir()).filter((name) => name.startsWith('serendipeak-refresh-'));

		before(() => {
			localContainer = docker('compose', 'ps', '-q', 'db').trim();
			assert.ok(
				localContainer,
				'the local database container must be running (docker compose up -d --wait)'
			);

			const env = parseEnv(readFileSync(join(ROOT, '.env'), 'utf8'));
			seedDatabase = new URL(env.DATABASE_URL).pathname.slice(1);
			assert.ok(
				Number(sql(localContainer, seedDatabase, 'select count(*) from mountain')) > 0,
				'the local catalog must not be empty'
			);

			directory = scratch();
			targetEnvTemplate = env;
			return freePort().then((port) => {
				sourcePort = port;
				docker(
					'run',
					'-d',
					'--name',
					sourceContainer,
					'--platform',
					'linux/amd64',
					'-e',
					'POSTGRES_USER=serendipeak',
					'-e',
					'POSTGRES_PASSWORD=rehearsal-source-pw',
					'-e',
					'POSTGRES_DB=serendipeak',
					'-p',
					`127.0.0.1:${port}:5432`,
					'postgis/postgis:18-3.6'
				);
				for (let attempt = 0; attempt < 60; attempt++) {
					try {
						docker('exec', sourceContainer, 'pg_isready', '-U', 'serendipeak', '-h', '127.0.0.1');
						break;
					} catch {
						execFileSync('sleep', ['2']);
					}
				}

				clone(localContainer, seedDatabase, sourceContainer, sourceDatabases[0]);
				clone(localContainer, seedDatabase, sourceContainer, sourceDatabases[1]);
				sql(
					sourceContainer,
					sourceDatabases[0],
					'update mountain set elevation_meters = elevation_meters + 7 where slug = (select slug from mountain order by slug limit 1)'
				);
				// A published mountain without photograph media violates the publication invariants.
				sql(
					sourceContainer,
					sourceDatabases[1],
					'update mountain_image set original_key = null, original_sha256 = null, page_key = null, viewer_key = null where mountain_id = (select id from mountain order by slug limit 1)'
				);
				operatorFile = operatorEnv(sourceDatabases[0]);
			});
		});

		after(() => {
			for (const name of databases())
				sql(localContainer, 'postgres', `drop database "${name}" with (force)`);
			try {
				docker('rm', '-f', sourceContainer);
			} catch {
				// Already gone.
			}
			rmSync(directory, { recursive: true, force: true });
		});

		test('replaces the live database, keeps its accounts and leaves a backup behind', async () => {
			const live = newLive('swap');
			const beforeDirectories = snapshotDirectories().length;
			const slug = sql(
				sourceContainer,
				sourceDatabases[0],
				'select slug from mountain order by slug limit 1'
			);
			const sourceElevation = sql(
				sourceContainer,
				sourceDatabases[0],
				`select elevation_meters from mountain where slug = '${slug}'`
			);
			const oldElevation = sql(
				localContainer,
				live.name,
				`select elevation_meters from mountain where slug = '${slug}'`
			);
			assert.notEqual(sourceElevation, oldElevation);

			const result = await run(['--no-tunnel', '--env-file', live.envFile]);

			assert.equal(result.code, 0, result.output);
			assert.equal(
				sql(
					localContainer,
					live.name,
					`select elevation_meters from mountain where slug = '${slug}'`
				),
				sourceElevation
			);
			assert.match(
				sql(
					localContainer,
					live.name,
					"select string_agg(username, ',' order by username) from app_user"
				),
				/rehearsal-swap/
			);
			assert.equal(
				sql(localContainer, live.name, 'select count(*) from django_session'),
				sql(localContainer, seedDatabase, 'select count(*) from django_session')
			);

			const backup = databases().find((name) => name.startsWith(`${live.name}_pre_refresh_`));
			assert.ok(backup, 'the previous database is kept');
			assert.equal(
				sql(localContainer, backup, `select elevation_meters from mountain where slug = '${slug}'`),
				oldElevation
			);
			assert.ok(
				!databases().some((name) => name.startsWith(`${live.name}_refresh_`)),
				'no temporary database is left'
			);
			assert.equal(
				snapshotDirectories().length,
				beforeDirectories,
				'the snapshot directory is removed'
			);
			assert.ok(!existsSync(join(tmpdir(), 'serendipeak-db-refresh.lock')), 'the lock is released');
			assert.doesNotMatch(result.output, /rehearsal-source-pw|dummy-secret/);

			const restored = await run(['--restore', backup, '--env-file', live.envFile]);
			assert.equal(restored.code, 0, restored.output);
			assert.equal(
				sql(
					localContainer,
					live.name,
					`select elevation_meters from mountain where slug = '${slug}'`
				),
				oldElevation
			);
		});

		test('a dry run changes nothing and removes its temporary database', async () => {
			const live = newLive('dry');
			const fingerprint = () =>
				sql(
					localContainer,
					live.name,
					"select md5(string_agg(slug || elevation_meters, ',' order by slug)) from mountain"
				);
			const initial = fingerprint();

			const result = await run(['--no-tunnel', '--dry-run', '--env-file', live.envFile]);

			assert.equal(result.code, 0, result.output);
			assert.match(result.output, /Dry run/);
			assert.equal(fingerprint(), initial);
			assert.deepEqual(
				databases().filter((name) => name.startsWith(`${live.name}`)),
				[live.name]
			);
		});

		test('an unreachable source stops before anything is created', async () => {
			const live = newLive('down');
			const dead = await freePort();

			const result = await run(['--no-tunnel', '--env-file', live.envFile], {
				env: { OPERATOR_ENV: operatorEnv(sourceDatabases[0], dead) },
			});

			assert.notEqual(result.code, 0);
			assert.match(result.output, /Could not read the source database/);
			assert.match(result.output, /The local database was not modified/);
			assert.deepEqual(
				databases().filter((name) => name.startsWith(`${live.name}`)),
				[live.name]
			);
		});

		test('a source that fails the publication invariants never reaches the live database', async () => {
			const live = newLive('bad');
			const initial = mountainCount(live.name);

			const result = await run(['--no-tunnel', '--env-file', live.envFile], {
				env: { OPERATOR_ENV: operatorEnv(sourceDatabases[1]) },
			});

			assert.notEqual(result.code, 0);
			assert.match(result.output, /check_catalog failed[\s\S]*image_media_missing/);
			assert.match(result.output, /The local database was not modified/);
			assert.equal(mountainCount(live.name), initial);
			assert.deepEqual(
				databases().filter((name) => name.startsWith(`${live.name}`)),
				[live.name]
			);
		});

		test('a source on the destination server is refused', async () => {
			const live = newLive('same');
			const localPort = new URL(targetEnvTemplate.DATABASE_URL).port;

			const result = await run(['--no-tunnel', '--env-file', live.envFile], {
				env: { OPERATOR_ENV: operatorEnv(sourceDatabases[0], localPort) },
			});

			assert.notEqual(result.code, 0);
			assert.match(result.output, /same local port/);
		});

		test('a failing final check restores the previous database', async () => {
			const live = newLive('final');
			const slug = sql(
				localContainer,
				live.name,
				'select slug from mountain order by slug limit 1'
			);
			const oldElevation = sql(
				localContainer,
				live.name,
				`select elevation_meters from mountain where slug = '${slug}'`
			);

			const real = createExec({ redact: (text) => text });
			const exec = (command, args, options) =>
				command === 'uv' &&
				args.includes('check_catalog') &&
				options?.env?.DATABASE_URL?.endsWith(`/${live.name}`)
					? Promise.resolve({ code: 1, stdout: '', stderr: 'injected failure', timedOut: false })
					: real(command, args, options);

			const messages = [];
			const previous = process.env.OPERATOR_ENV;
			process.env.OPERATOR_ENV = operatorFile;
			try {
				await assert.rejects(
					refresh(
						{ envFile: live.envFile, noTunnel: true, dryRun: false },
						{
							log: (message) => messages.push(message),
							exec,
							signal: new AbortController().signal,
							addSecrets() {},
						}
					),
					/injected failure/
				);
			} finally {
				process.env.OPERATOR_ENV = previous;
			}

			assert.ok(messages.some((message) => message.includes('previous one again')));
			assert.equal(
				sql(
					localContainer,
					live.name,
					`select elevation_meters from mountain where slug = '${slug}'`
				),
				oldElevation
			);
			assert.match(
				sql(localContainer, live.name, "select string_agg(username, ',') from app_user"),
				/rehearsal-final/
			);
			assert.ok(!databases().some((name) => name.startsWith(`${live.name}_refresh_`)));
		});

		test('a failed swap leaves the live database connectable', async () => {
			const live = newLive('rename');
			const pg = new LocalPostgres({
				exec: createExec({ redact: (text) => text }),
				container: localContainer,
				user: 'serendipeak',
			});

			await assert.rejects(
				swapDatabases(pg, {
					live: live.name,
					replacement: `${live.name}_missing`,
					retired: `${live.name}_retired`,
				})
			);

			assert.equal(sql(localContainer, live.name, 'select count(*) > 0 from mountain'), 't');
			assert.equal(
				sql(
					localContainer,
					'postgres',
					`select datallowconn from pg_database where datname = '${live.name}'`
				),
				't'
			);
			assert.ok(!databases().includes(`${live.name}_retired`));
		});

		test('production sessions refuse writes', () => {
			const exec = createExec({ redact: (text) => text });

			return exec(
				'uv',
				[
					'run',
					'--env-file',
					operatorFile,
					'python',
					'manage.py',
					'shell',
					'-c',
					"from django.db import connection\nconnection.cursor().execute('create table refresh_write_probe(x int)')",
				],
				{
					cwd: join(ROOT, 'services/api'),
					env: { PATH: process.env.PATH, HOME: process.env.HOME, PGOPTIONS: READ_ONLY_OPTIONS },
				}
			).then((result) => {
				assert.notEqual(result.code, 0);
				assert.match(result.stderr, /read-only transaction/);
				assert.equal(
					sql(
						sourceContainer,
						sourceDatabases[0],
						"select to_regclass('public.refresh_write_probe') is null"
					),
					't'
				);
			});
		});

		test('a second run is refused while one holds the lock', async () => {
			const live = newLive('lock');
			const release = await acquireLock();
			try {
				const result = await run(['--no-tunnel', '--dry-run', '--env-file', live.envFile]);

				assert.notEqual(result.code, 0);
				assert.match(result.output, /Another refresh is running/);
			} finally {
				release();
			}
		});

		test('an interrupted run cleans up and leaves the live database untouched', async () => {
			const live = newLive('signal');
			const initial = mountainCount(live.name);
			let signalled = false;

			const result = await run(['--no-tunnel', '--env-file', live.envFile], {
				onLine(child, output) {
					if (!signalled && output.includes('Applying migrations')) {
						signalled = true;
						child.kill('SIGINT');
					}
				},
			});

			assert.equal(result.code, 130, result.output);
			assert.equal(mountainCount(live.name), initial);
			assert.deepEqual(
				databases().filter((name) => name.startsWith(`${live.name}`)),
				[live.name]
			);
			assert.ok(!existsSync(join(tmpdir(), 'serendipeak-db-refresh.lock')));
		});
	}
);
