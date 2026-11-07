// SerendiPeak's live-API verifier. It descends from the vendored contracts/v1/verify-api.mjs,
// which stays untouched and describes the v1 API, and differs from it exactly where SerendiPeak's
// own contract does: a photograph has one `author` instead of `attribution` and `creator`, and
// no `sourceIdentifier`; a mountain serves no `prominenceMeters` and no `sources.wikipedia`, a
// `continent` object and `countries` as `{code, name}` objects instead of names. The curated
// identity of each of the 73 photographs is its source page and its dimensions.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const COORDINATE_TOLERANCE = 1e-7;
const CAMERA_TOLERANCE = 1e-9;
const CONTINENT_CODES = new Set(["AF", "AN", "AS", "EU", "NA", "OC", "SA"]);
const COUNTRY_CODE = /^[A-Z]{2}$/;

const STATEFUL_TODAY_FLAG = "--include-stateful-today";
const GEOGRAPHY_FLAG = "--geography";
const GEOGRAPHY_SHA256_FLAG = "--geography-sha256";
const USAGE = `usage: node scripts/verify-api.mjs <api-base-url> [${STATEFUL_TODAY_FLAG}]
  [${GEOGRAPHY_FLAG} <file> ${GEOGRAPHY_SHA256_FLAG} <sha256>]

Read-only by default: GET /api/v1/mountains/today is NOT requested.
${STATEFUL_TODAY_FLAG}  also request today. On a new UTC date the API persists that
  date's discovery. Use it only against a disposable or test database, or when
  that mutation is intended.
${GEOGRAPHY_FLAG} and ${GEOGRAPHY_SHA256_FLAG}  also compare the continent and countries of the
  mountains the private geography input covers. The shapes are always checked; without
  the input the comparison of values is skipped, and the output says so.`;

const rawArgs = process.argv.slice(2);
const options = {};
const args = [];
for (let index = 0; index < rawArgs.length; index += 1) {
  if (
    rawArgs[index] === GEOGRAPHY_FLAG ||
    rawArgs[index] === GEOGRAPHY_SHA256_FLAG
  ) {
    options[rawArgs[index]] = rawArgs[(index += 1)];
  } else {
    args.push(rawArgs[index]);
  }
}
const unknownFlags = args.filter(
  (arg) => arg.startsWith("-") && arg !== STATEFUL_TODAY_FLAG,
);
if (unknownFlags.length > 0) {
  console.error(`unknown option: ${unknownFlags.join(", ")}\n${USAGE}`);
  process.exit(2);
}
if (
  (options[GEOGRAPHY_FLAG] === undefined) !==
  (options[GEOGRAPHY_SHA256_FLAG] === undefined)
) {
  console.error(
    `${GEOGRAPHY_FLAG} and ${GEOGRAPHY_SHA256_FLAG} go together\n${USAGE}`,
  );
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
  readFileSync(
    new URL("../contracts/v1/catalog.json", import.meta.url),
    "utf8",
  ),
);
const frozenSlugs = new Set(snapshot.mountains.map((entry) => entry.slug));
const failures = [];

// The same canonical serialization as the tracked tools: sorted keys, no whitespace.
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const members = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value);
}

function loadGeography() {
  if (options[GEOGRAPHY_FLAG] === undefined) {
    return undefined;
  }
  const document = JSON.parse(readFileSync(options[GEOGRAPHY_FLAG], "utf8"));
  const { content_sha256: stated, ...content } = document;
  const actual = createHash("sha256")
    .update(canonicalJson(content))
    .digest("hex");
  if (actual !== stated || actual !== options[GEOGRAPHY_SHA256_FLAG]) {
    console.error("the geography input does not have the expected checksum");
    process.exit(2);
  }
  return new Map(document.mountains.map((entry) => [entry.slug, entry]));
}

const geography = loadGeography();
let geographyCompared = 0;

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

function checkGeographyShape(scope, mountain) {
  const continent = mountain.continent;
  if (typeof continent !== "object" || continent === null) {
    fail(scope, "continent is missing or not an object");
  } else {
    if (!CONTINENT_CODES.has(continent.code)) {
      fail(
        scope,
        `continent code ${JSON.stringify(continent.code)} is not an approved code`,
      );
    }
    if (typeof continent.name !== "string" || continent.name === "") {
      fail(scope, "continent name is not a non-empty string");
    }
  }

  const countries = mountain.countries;
  if (!Array.isArray(countries)) {
    fail(scope, "countries is not an array");
    return;
  }
  for (const country of countries) {
    if (typeof country !== "object" || country === null) {
      fail(
        scope,
        `country ${JSON.stringify(country)} is not a {code, name} object`,
      );
    } else if (
      typeof country.code !== "string" ||
      !COUNTRY_CODE.test(country.code)
    ) {
      fail(scope, `country code ${JSON.stringify(country.code)} is malformed`);
    } else if (typeof country.name !== "string" || country.name === "") {
      fail(scope, `country ${country.code} has no name`);
    }
  }
  const valid = countries.filter(
    (country) =>
      typeof country?.code === "string" && typeof country?.name === "string",
  );
  if (new Set(valid.map((country) => country.code)).size !== valid.length) {
    fail(scope, "countries repeat a code");
  }
  const ordered = [...valid].sort(
    (a, b) =>
      compareCodePoints(a.name, b.name) || compareCodePoints(a.code, b.code),
  );
  if (valid.some((country, index) => country !== ordered[index])) {
    fail(scope, "countries are not ordered by English name, then code");
  }
  if (
    mountain.rangeName !== undefined &&
    typeof mountain.rangeName !== "string"
  ) {
    fail(scope, "rangeName is not a string");
  }
}

function compareCodePoints(a, b) {
  const left = [...a];
  const right = [...b];
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const difference = left[index].codePointAt(0) - right[index].codePointAt(0);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.length - right.length;
}

function checkGeographyValues(scope, served) {
  const entry = geography?.get(served.slug);
  if (entry === undefined) {
    return;
  }
  geographyCompared += 1;
  if (served.continent?.code !== entry.continent) {
    fail(scope, `continent ${served.continent?.code}, want ${entry.continent}`);
  }
  const codes = (served.countries ?? []).map((country) => country.code).sort();
  const wanted = [...entry.countries].sort();
  if (JSON.stringify(codes) !== JSON.stringify(wanted)) {
    fail(
      scope,
      `countries ${codes.join(",") || "none"}, want ${wanted.join(",") || "none"}`,
    );
  }
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
  checkGeographyShape(scope, mountain);
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
    checkGeographyValues(scope, served);
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
    for (const field of ["sourcePageUrl", "width", "height"]) {
      if (image?.[field] !== frozen.primaryImage[field]) {
        fail(
          scope,
          `primaryImage.${field} ${image?.[field]}, want ${frozen.primaryImage[field]}`,
        );
      }
    }
    for (const field of ["url", "author"]) {
      if (typeof image?.[field] !== "string" || image[field] === "") {
        fail(scope, `primaryImage.${field} is missing`);
      }
    }
    for (const field of ["attribution", "creator", "sourceIdentifier"]) {
      if (image?.[field] !== undefined) {
        fail(
          scope,
          `primaryImage.${field} is served; SerendiPeak has no such member`,
        );
      }
    }
    if (served.prominenceMeters !== undefined) {
      fail(scope, "prominenceMeters is served; SerendiPeak has no such member");
    }
    if (served.sources?.wikipedia !== undefined) {
      fail(
        scope,
        "sources.wikipedia is served; SerendiPeak has no such member",
      );
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

const geographyNote =
  geography === undefined
    ? `geography: shapes checked; the comparison of values was skipped (pass ${GEOGRAPHY_FLAG} and ${GEOGRAPHY_SHA256_FLAG} to include it).`
    : `geography: shapes checked, and the continent and countries of ${geographyCompared} mountains compared with the private input.`;

if (failures.length > 0) {
  console.error(
    `${failures.length} contract difference(s) against ${baseUrl}:`,
  );
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error(geographyNote);
  process.exit(1);
}

console.log(
  `${baseUrl} serves the ${snapshot.mountains.length} v1 mountains, the random contract, and the error envelope (read-only checks).`,
);
console.log(geographyNote);
console.log(
  includeStatefulToday
    ? "stateful check: GET /api/v1/mountains/today requested and verified (may have persisted the current UTC date)."
    : `stateful check: GET /api/v1/mountains/today skipped; pass ${STATEFUL_TODAY_FLAG} to include it.`,
);
