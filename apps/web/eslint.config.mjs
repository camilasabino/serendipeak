import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const FETCH_BOUNDARY_MESSAGE =
	'Call the API through MountainApi. Only src/api/HttpMountainApi.ts may use fetch.';
const FETCH_HOLDERS = '/^(globalThis|window|self)$/';
const CESIUM_BOUNDARY_MESSAGE =
	'Reach the engine through GlobeScene. Only src/stage/globe/cesium/ may import cesium.';

const FETCH_SELECTORS = [
	{
		selector: `MemberExpression[object.name=${FETCH_HOLDERS}][property.name='fetch']`,
		message: FETCH_BOUNDARY_MESSAGE
	},
	{
		selector: `MemberExpression[object.name=${FETCH_HOLDERS}][computed=true][property.value='fetch']`,
		message: FETCH_BOUNDARY_MESSAGE
	},
	{
		selector: `VariableDeclarator[init.name=${FETCH_HOLDERS}] > ObjectPattern > Property[key.name='fetch']`,
		message: FETCH_BOUNDARY_MESSAGE
	}
];

// Core no-restricted-imports does not see dynamic import().
const CESIUM_DYNAMIC_IMPORT_SELECTOR = {
	selector: 'ImportExpression[source.value=/^(@cesium\\/|cesium(\\/|$))/]',
	message: CESIUM_BOUNDARY_MESSAGE
};

const FETCH_RULES = {
	'no-restricted-globals': ['error', { name: 'fetch', message: FETCH_BOUNDARY_MESSAGE }]
};

const CESIUM_IMPORT_RULE = [
	'error',
	{
		paths: [{ name: 'cesium', message: CESIUM_BOUNDARY_MESSAGE }],
		patterns: [{ group: ['cesium/*', '@cesium/*'], message: CESIUM_BOUNDARY_MESSAGE }]
	}
];

export default defineConfig([
	...nextVitals,
	...nextTypescript,
	globalIgnores([
		'.next/**',
		'.next-e2e/**',
		'node_modules/**',
		'next-env.d.ts',
		'playwright-report/**',
		'test-results/**',
		'public/cesium/**'
	]),
	{
		files: ['**/*.{js,mjs,cjs,ts,tsx}'],
		ignores: ['src/api/HttpMountainApi.ts', 'src/stage/globe/cesium/**'],
		rules: {
			...FETCH_RULES,
			'no-restricted-imports': CESIUM_IMPORT_RULE,
			'no-restricted-syntax': ['error', ...FETCH_SELECTORS, CESIUM_DYNAMIC_IMPORT_SELECTOR]
		}
	},
	{
		files: ['src/api/HttpMountainApi.ts'],
		rules: {
			'no-restricted-imports': CESIUM_IMPORT_RULE,
			'no-restricted-syntax': ['error', CESIUM_DYNAMIC_IMPORT_SELECTOR]
		}
	},
	{
		files: ['src/stage/globe/cesium/**'],
		rules: {
			...FETCH_RULES,
			'no-restricted-syntax': ['error', ...FETCH_SELECTORS]
		}
	}
]);
