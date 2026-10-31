const WGS84_A = 6378137;
const WGS84_B = 6356752.314245179;
const WGS84_ECCENTRICITY_SQUARED = 1 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A);
const MAX_QUANTIZED = 32767;
const MAX_LEVEL = 15;
const GRID_VERTICES = 9;

type Vector3 = [number, number, number];

export const TERRAIN_LAYER = {
	tilejson: '2.1.0',
	format: 'quantized-mesh-1.0',
	version: '1.0.0',
	scheme: 'tms',
	tiles: ['{z}/{x}/{y}.terrain?v={version}'],
	projection: 'EPSG:4326',
	maxzoom: MAX_LEVEL,
	available: Array.from({ length: MAX_LEVEL + 1 }, (_, level) => [
		{ startX: 0, endX: 2 ** (level + 1) - 1, startY: 0, endY: 2 ** level - 1 }
	])
};

function cartesian(longitude: number, latitude: number): Vector3 {
	const sinLatitude = Math.sin(latitude);
	const radius = WGS84_A / Math.sqrt(1 - WGS84_ECCENTRICITY_SQUARED * sinLatitude * sinLatitude);
	return [
		radius * Math.cos(latitude) * Math.cos(longitude),
		radius * Math.cos(latitude) * Math.sin(longitude),
		radius * (1 - WGS84_ECCENTRICITY_SQUARED) * sinLatitude
	];
}

function tileRectangle(level: number, x: number, y: number) {
	const size = Math.PI / 2 ** level;
	return {
		west: -Math.PI + x * size,
		east: -Math.PI + (x + 1) * size,
		south: -Math.PI / 2 + y * size,
		north: -Math.PI / 2 + (y + 1) * size
	};
}

function distance(a: Vector3, b: Vector3): number {
	return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function zigZagDeltaEncode(values: number[]): number[] {
	let previous = 0;
	return values.map((value) => {
		const delta = value - previous;
		previous = value;
		return ((delta << 1) ^ (delta >> 31)) & 0xffff;
	});
}

interface GridMesh {
	u: number[];
	v: number[];
	triangles: number[];
	west: number[];
	south: number[];
	east: number[];
	north: number[];
}

function buildGridMesh(size: number): GridMesh {
	const original: number[] = [];
	for (let row = 0; row < size; row += 1) {
		for (let column = 0; column < size; column += 1) {
			original.push(row * size + column);
		}
	}
	const rawTriangles: number[] = [];
	for (let row = 0; row < size - 1; row += 1) {
		for (let column = 0; column < size - 1; column += 1) {
			const southWest = row * size + column;
			const southEast = southWest + 1;
			const northWest = southWest + size;
			const northEast = northWest + 1;
			rawTriangles.push(southWest, southEast, northWest, northWest, southEast, northEast);
		}
	}
	const relabelled = new Map<number, number>();
	const order: number[] = [];
	const triangles = rawTriangles.map((vertex) => {
		let label = relabelled.get(vertex);
		if (label === undefined) {
			label = order.length;
			relabelled.set(vertex, label);
			order.push(vertex);
		}
		return label;
	});
	const step = MAX_QUANTIZED / (size - 1);
	const u = order.map((vertex) => Math.round((vertex % size) * step));
	const v = order.map((vertex) => Math.round(Math.floor(vertex / size) * step));
	const label = (row: number, column: number) => relabelled.get(row * size + column)!;
	const along = Array.from({ length: size }, (_, index) => index);
	return {
		u,
		v,
		triangles,
		west: along.map((row) => label(row, 0)),
		south: along.map((column) => label(0, column)),
		east: along.map((row) => label(row, size - 1)),
		north: along.map((column) => label(size - 1, column))
	};
}

function highWaterMarkEncode(indices: number[]): number[] {
	let highest = 0;
	return indices.map((index) => {
		const code = highest - index;
		if (code === 0) {
			highest += 1;
		}
		return code;
	});
}

const MESH = buildGridMesh(GRID_VERTICES);
const ENCODED_TRIANGLES = highWaterMarkEncode(MESH.triangles);
const ENCODED_U = zigZagDeltaEncode(MESH.u);
const ENCODED_V = zigZagDeltaEncode(MESH.v);
const ENCODED_HEIGHT = zigZagDeltaEncode(MESH.u.map(() => 0));
const EDGES = [MESH.west, MESH.south, MESH.east, MESH.north];

export function flatTerrainTile(level: number, x: number, y: number): Buffer {
	const { west, east, south, north } = tileRectangle(level, x, y);
	const center = cartesian((west + east) / 2, (south + north) / 2);
	let radius = 0;
	let angularRadius = 0;
	for (let i = 0; i <= 4; i += 1) {
		for (let j = 0; j <= 4; j += 1) {
			const point = cartesian(west + ((east - west) * i) / 4, south + ((north - south) * j) / 4);
			radius = Math.max(radius, distance(center, point));
			const cosine =
				(center[0] * point[0] + center[1] * point[1] + center[2] * point[2]) /
				(Math.hypot(...center) * Math.hypot(...point));
			angularRadius = Math.max(angularRadius, Math.acos(Math.min(1, cosine)));
		}
	}
	const magnitude = angularRadius > 1.4 ? 1000 : 1 / Math.cos(angularRadius);
	const scaled: Vector3 = [center[0] / WGS84_A, center[1] / WGS84_A, center[2] / WGS84_B];
	const scaledLength = Math.hypot(...scaled);
	const horizonOcclusionPoint = scaled.map((component) => (component / scaledLength) * magnitude);

	const vertexCount = MESH.u.length;
	let size = 3 * 8 + 4 + 4 + 4 * 8 + 3 * 8 + 4 + vertexCount * 3 * 2;
	const triangleBytes = vertexCount > 65536 ? 4 : 2;
	size += 4 + ENCODED_TRIANGLES.length * triangleBytes;
	size += EDGES.reduce((total, edge) => total + 4 + edge.length * triangleBytes, 0);
	const buffer = Buffer.alloc(size);
	let position = 0;
	const writeDouble = (value: number) => {
		buffer.writeDoubleLE(value, position);
		position += 8;
	};
	const writeFloat = (value: number) => {
		buffer.writeFloatLE(value, position);
		position += 4;
	};
	const writeUint16 = (value: number) => {
		buffer.writeUInt16LE(value, position);
		position += 2;
	};
	const writeUint32 = (value: number) => {
		buffer.writeUInt32LE(value, position);
		position += 4;
	};

	center.forEach(writeDouble);
	writeFloat(0);
	writeFloat(0);
	center.forEach(writeDouble);
	writeDouble(radius);
	horizonOcclusionPoint.forEach(writeDouble);
	writeUint32(vertexCount);
	ENCODED_U.forEach(writeUint16);
	ENCODED_V.forEach(writeUint16);
	ENCODED_HEIGHT.forEach(writeUint16);
	writeUint32(ENCODED_TRIANGLES.length / 3);
	ENCODED_TRIANGLES.forEach(writeUint16);
	for (const edge of EDGES) {
		writeUint32(edge.length);
		edge.forEach(writeUint16);
	}
	return buffer;
}
