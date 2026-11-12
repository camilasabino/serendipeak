export const STUB_API_PORT = Number(process.env.STUB_API_PORT ?? 8099);
export const WEB_PORT = 3100;

/** A public origin unlike the server's own, so a canonical URL cannot come from the request. */
export const SITE_ORIGIN = 'https://serendipeak.example';
