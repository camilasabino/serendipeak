import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const FETCH_BOUNDARY_MESSAGE =
	'Call the API through MountainApi. Only src/api/HttpMountainApi.ts may use fetch.';
const FETCH_HOLDERS = '/^(globalThis|window|self)$/';

export default defineConfig([
	...nextVitals,
	...nextTypescript,
	globalIgnores([
		'.next/**',
		'node_modules/**',
		'next-env.d.ts',
		'playwright-report/**',
		'test-results/**'
	]),
	{
		files: ['**/*.{js,mjs,cjs,ts,tsx}'],
		ignores: ['src/api/HttpMountainApi.ts'],
		rules: {
			'no-restricted-globals': ['error', { name: 'fetch', message: FETCH_BOUNDARY_MESSAGE }],
			'no-restricted-syntax': [
				'error',
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
			]
		}
	}
]);
