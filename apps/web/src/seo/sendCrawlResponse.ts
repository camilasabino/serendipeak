import type { ServerResponse } from 'node:http';
import type { CrawlResponse } from './crawlResponses';

export function sendCrawlResponse(res: ServerResponse, { status, headers, body }: CrawlResponse) {
	res.statusCode = status;
	for (const [name, value] of Object.entries(headers)) {
		res.setHeader(name, value);
	}
	res.end(body);
}
