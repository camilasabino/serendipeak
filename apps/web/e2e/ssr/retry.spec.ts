import { expect, test } from '@playwright/test';
import { fixture, resetStub, useScenario } from './support';

const daily = fixture<{ mountain: { name: string } }>('daily-mountain.json');

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

test.afterEach(async ({ request }) => {
	await resetStub(request);
});

test('Try again recovers through the page flow once the API is back', async ({ page, request }) => {
	await useScenario(request, 'unreachable');
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText("We couldn't load the mountain");

	await useScenario(request, 'ok');
	await page.getByRole('button', { name: 'Try again' }).click();

	await expect(page.getByRole('heading', { level: 1 })).toHaveText(daily.mountain.name);
	await expect(page).toHaveTitle(`Today's discovery: ${daily.mountain.name} · SerendiPeak`);
});

test('Try again keeps the error view while the API stays down', async ({ page, request }) => {
	await useScenario(request, 'server-error');
	await page.goto('/mountains/aconcagua');

	await page.getByRole('button', { name: 'Try again' }).click();

	await expect(page.getByRole('heading', { level: 1 })).toHaveText("We couldn't load the mountain");
	await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
});
