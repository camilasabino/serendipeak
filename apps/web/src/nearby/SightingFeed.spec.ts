import { describe, expect, it } from 'vitest';
import type { SummitSightings } from '../stage/globe/summitSighting';
import { SightingFeed } from './SightingFeed';

const READING: SummitSightings = {
	viewport: { width: 800, height: 600 },
	presented: { kind: 'ahead', x: 400, y: 300 },
	nearby: []
};

describe('SightingFeed', () => {
	it('hands a new listener the latest reading, then every later one until it leaves', () => {
		const feed = new SightingFeed();
		const heard: (SummitSightings | undefined)[] = [];

		feed.publish(READING);
		const leave = feed.subscribe((reading) => heard.push(reading));
		feed.publish(undefined);
		leave();
		feed.publish(READING);

		expect(heard).toEqual([READING, undefined]);
	});
});
