import type { GetServerSidePropsContext } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mountain } from '../api/contract';
import { FakeMountainApi } from '../api/test-support/FakeMountainApi';
import { contractFixture } from '../api/test-support/contractFixtures';
import { getServerSideProps } from '../pages/mountains/[slug]';

const api = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock('../api/serverMountainApi', () => ({
	createServerMountainApi: () => api.current
}));

const mountain = contractFixture('mountain-complete.json') as Mountain;

function request(slug: string, response = { statusCode: 200, setHeader: vi.fn() }) {
	const context = { params: { slug }, res: response } as unknown as GetServerSidePropsContext;

	return { response, result: getServerSideProps(context) };
}

describe('the mountain route', () => {
	beforeEach(() => {
		api.current = new FakeMountainApi({
			mountain: { kind: 'found', mountain: { ...mountain, slug: 'aconcagua-renamed' } }
		});
	});

	it('redirects an old slug permanently to the current address', async () => {
		const { response, result } = request('aconcagua');

		expect(await result).toEqual({
			redirect: { destination: '/mountains/aconcagua-renamed', statusCode: 308 }
		});
		expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
	});

	it('renders the current slug as a page without a redirect', async () => {
		const { response, result } = request('aconcagua-renamed');

		const props = await result;

		expect(props).toHaveProperty('props.model.kind', 'mountain');
		expect(props).not.toHaveProperty('redirect');
		expect(response.statusCode).toBe(200);
	});

	it.each(['Aconcagua', 'a--b', 'today', '..'])(
		'keeps a malformed slug (%s) a 404 without asking the API',
		async (slug) => {
			const { response, result } = request(slug);

			expect(await result).toHaveProperty('props.model.reason', 'not-found');
			expect(response.statusCode).toBe(404);
			expect((api.current as FakeMountainApi).getMountainCalls).toEqual([]);
		}
	);

	it('keeps an unknown slug a 404 and an unreachable API a 503', async () => {
		api.current = new FakeMountainApi({ mountain: { kind: 'not-found' } });
		const unknown = request('nowhere');
		expect(await unknown.result).toHaveProperty('props.model.reason', 'not-found');
		expect(unknown.response.statusCode).toBe(404);

		api.current = new FakeMountainApi({ mountain: { kind: 'unreachable' } });
		const unreachable = request('nowhere');
		expect(await unreachable.result).toHaveProperty('props.model.reason', 'unreachable');
		expect(unreachable.response.statusCode).toBe(503);
	});
});
