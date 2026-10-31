import { cpSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const assetDirectories = ['Workers', 'ThirdParty', 'Assets', 'Widgets'];

const require = createRequire(import.meta.url);
const cesiumRoot = dirname(require.resolve('cesium/package.json'));
const source = join(cesiumRoot, 'Build', 'Cesium');
const target = resolve(import.meta.dirname, '..', 'public', 'cesium');

// Rebuilt from scratch so files from a previous Cesium version never survive an upgrade.
rmSync(target, { recursive: true, force: true });

for (const name of assetDirectories) {
	const from = join(source, name);
	if (!existsSync(from)) {
		console.error(`copy-cesium-assets: missing ${from}`);
		process.exit(1);
	}
	cpSync(from, join(target, name), { recursive: true });
}

console.log(`copy-cesium-assets: ${assetDirectories.join(', ')} copied to ${target}`);
