import { readFileSync } from "node:fs";

const COORDINATE_TOLERANCE = 1e-7;
const CAMERA_TOLERANCE = 1e-9;

const STATEFUL_TODAY_FLAG = "--include-stateful-today";
const USAGE = `usage: node contracts/v1/verify-api.mjs <api-base-url> [${STATEFUL_TODAY_FLAG}]

Read-only by default: GET /api/v1/mountains/today is NOT requested.
${STATEFUL_TODAY_FLAG}  also request today. On a new UTC date the API persists that
  date's discovery. Use it only against a disposable or test database, or when
  that mutation is intended.`;

const args = process.argv.slice(2);
const unknownFlags = args.filter(
  (arg) => arg.startsWith("-") && arg !== STATEFUL_TODAY_FLAG,
);
if (unknownFlags.length > 0) {
  console.error(`unknown option: ${unknownFlags.join(", ")}\n${USAGE}`);
  process.exit(2);
}
const includeStatefulToday = args.includes(STATEFUL_TODAY_FLAG);
const positional = args.filter((arg) => !arg.startsWith("-"));
const baseUrl = (positional[0] ?? process.env.API_BASE_URL ?? "").replace(
  /\/+$/,
  "",
);
if (!baseUrl || positional.length > 1) {
  console.error(USAGE);
  process.exit(2);
}

const snapshot = JSON.parse(
  readFileSync(new URL("./catalog.json", import.meta.url), "utf8"),
);
const frozenSlugs = new Set(snapshot.mountains.map((entry) => entry.slug));
const failures = [];

function fail(scope, message) {
  failures.push(`${scope}: ${message}`);
}

function near(actual, expected, tolerance) {
  return typeof actual === "number" && Math.abs(actual - expected) <= tolerance;
}

async function get(path) {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`);
  } catch (error) {
    console.error(
      `${baseUrl} is unreachable: ${error.cause?.code ?? error.message}`,
    );
    process.exit(1);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return { status: response.status, headers: response.headers, body };
}

function checkMountainShape(scope, mountain) {
  if (typeof mountain !== "object" || mountain === null) {
    fail(scope, "body is not a mountain object");
    return false;
  }
  for (const field of ["id", "slug", "name"]) {
    if (typeof mountain[field] !== "string" || mountain[field] === "") {
      fail(scope, `${field} is not a non-empty string`);
    }
  }
  if (!Number.isInteger(mountain.elevationMeters)) {
    fail(scope, "elevationMeters is not an integer");
  }
  if (!Array.isArray(mountain.countries)) {
    fail(scope, "countries is not an array");
  }
  for (const [field, value] of Object.entries(mountain)) {
    if (value === null || value === "") {
      fail(scope, `${field} is present without a value`);
    }
  }
  return true;
}

function checkErrorEnvelope(scope, response, status, code) {
  if (response.status !== status) {
    fail(scope, `status ${response.status}, want ${status}`);
  }
  const error = response.body?.error;
  const keys = response.body ? Object.keys(response.body) : [];
  if (keys.length !== 1 || typeof error !== "object" || error === null) {
    fail(scope, "body is not a single error object");
    return;
  }
  if (error.code !== code) {
    fail(scope, `code ${error.code}, want ${code}`);
  }
  if (typeof error.message !== "string" || error.message.trim() === "") {
    fail(scope, "message is not a non-empty string");
  }
}

async function checkCatalog() {
  for (const frozen of snapshot.mountains) {
    const scope = `GET /api/v1/mountains/${frozen.slug}`;
    const response = await get(
      `/api/v1/mountains/${encodeURIComponent(frozen.slug)}`,
    );
    if (response.status !== 200 || !checkMountainShape(scope, response.body)) {
      fail(scope, `status ${response.status}, want 200`);
      continue;
    }
    const served = response.body;
    if (served.slug !== frozen.slug || served.name !== frozen.name) {
      fail(scope, `identity ${served.slug} / ${served.name}`);
    }
    if (
      !near(
        served.coordinates?.latitude,
        frozen.coordinates.latitude,
        COORDINATE_TOLERANCE,
      ) ||
      !near(
        served.coordinates?.longitude,
        frozen.coordinates.longitude,
        COORDINATE_TOLERANCE,
      )
    ) {
      fail(scope, `coordinates ${JSON.stringify(served.coordinates)}`);
    }
    if (served.elevationMeters !== frozen.elevationMeters) {
      fail(
        scope,
        `elevation ${served.elevationMeters}, want ${frozen.elevationMeters}`,
      );
    }
    const camera = served.camera;
    if (
      !camera ||
      !near(
        camera.headingDegrees,
        frozen.camera.headingDegrees,
        CAMERA_TOLERANCE,
      ) ||
      !near(
        camera.pitchDegrees,
        frozen.camera.pitchDegrees,
        CAMERA_TOLERANCE,
      ) ||
      !near(camera.rangeMeters, frozen.camera.rangeMeters, CAMERA_TOLERANCE) ||
      !near(camera.framing?.x, frozen.camera.framing.x, CAMERA_TOLERANCE) ||
      !near(camera.framing?.y, frozen.camera.framing.y, CAMERA_TOLERANCE)
    ) {
      fail(scope, `camera ${JSON.stringify(camera)}`);
    }
    if (
      served.sources?.osm !== frozen.sources.osm ||
      served.sources?.wikidata !== frozen.sources.wikidata
    ) {
      fail(scope, `sources ${JSON.stringify(served.sources)}`);
    }
    const image = served.primaryImage;
    for (const field of [
      "sourceIdentifier",
      "sourcePageUrl",
      "width",
      "height",
    ]) {
      if (image?.[field] !== frozen.primaryImage[field]) {
        fail(
          scope,
          `primaryImage.${field} ${image?.[field]}, want ${frozen.primaryImage[field]}`,
        );
      }
    }
    for (const field of ["url", "attribution"]) {
      if (typeof image?.[field] !== "string" || image[field] === "") {
        fail(scope, `primaryImage.${field} is missing`);
      }
    }
  }
}

async function checkStatefulToday() {
  const today = await get("/api/v1/mountains/today");
  if (today.status !== 200) {
    fail("GET /api/v1/mountains/today", `status ${today.status}, want 200`);
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today.body?.date ?? "")) {
      fail("GET /api/v1/mountains/today", `date ${today.body?.date}`);
    }
    checkMountainShape("GET /api/v1/mountains/today", today.body?.mountain);
  }
  if (today.headers.get("cache-control") !== "no-store") {
    fail("GET /api/v1/mountains/today", "Cache-Control is not no-store");
  }
}

async function checkReadOnlyDiscovery() {
  const random = await get("/api/v1/mountains/random?exclude=aconcagua");
  if (
    random.status !== 200 ||
    !checkMountainShape("GET /api/v1/mountains/random", random.body)
  ) {
    fail("GET /api/v1/mountains/random", `status ${random.status}, want 200`);
  } else if (
    random.body.slug === "aconcagua" ||
    !frozenSlugs.has(random.body.slug)
  ) {
    fail("GET /api/v1/mountains/random", `returned ${random.body.slug}`);
  }
  if (random.headers.get("cache-control") !== "no-store") {
    fail("GET /api/v1/mountains/random", "Cache-Control is not no-store");
  }

  checkErrorEnvelope(
    "GET /api/v1/mountains/not-a-v1-mountain",
    await get("/api/v1/mountains/not-a-v1-mountain"),
    404,
    "MOUNTAIN_NOT_FOUND",
  );
}

await checkCatalog();
await checkReadOnlyDiscovery();
if (includeStatefulToday) {
  await checkStatefulToday();
}

if (failures.length > 0) {
  console.error(
    `${failures.length} contract difference(s) against ${baseUrl}:`,
  );
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `${baseUrl} serves the ${snapshot.mountains.length} v1 mountains, the random contract, and the error envelope (read-only checks).`,
);
console.log(
  includeStatefulToday
    ? "stateful check: GET /api/v1/mountains/today requested and verified (may have persisted the current UTC date)."
    : `stateful check: GET /api/v1/mountains/today skipped; pass ${STATEFUL_TODAY_FLAG} to include it.`,
);
