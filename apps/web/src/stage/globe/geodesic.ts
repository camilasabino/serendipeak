export interface GeoPoint {
	latitude: number;
	longitude: number;
}

export const EARTH_MEAN_RADIUS_METERS = 6_371_008.8;

const ANTIPODAL_SINE_EPSILON = 1e-9;

type Vector = [number, number, number];

function toRadians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
	return (radians * 180) / Math.PI;
}

function unitVector({ latitude, longitude }: GeoPoint): Vector {
	const φ = toRadians(latitude);
	const λ = toRadians(longitude);
	return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
}

function geoPoint([x, y, z]: Vector): GeoPoint {
	const longitude = toDegrees(Math.atan2(y, x));
	return {
		latitude: toDegrees(Math.atan2(z, Math.hypot(x, y))),
		longitude: ((((longitude + 180) % 360) + 360) % 360) - 180
	};
}

function dot(a: Vector, b: Vector): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vector, b: Vector): Vector {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(vector: Vector): Vector {
	const length = Math.hypot(...vector);
	return length > 0 ? [vector[0] / length, vector[1] / length, vector[2] / length] : vector;
}

function centralAngle(a: Vector, b: Vector): number {
	return Math.atan2(Math.hypot(...cross(a, b)), dot(a, b));
}

export function greatCircleDistanceMeters(from: GeoPoint, to: GeoPoint): number {
	return EARTH_MEAN_RADIUS_METERS * centralAngle(unitVector(from), unitVector(to));
}

export function initialBearingDegrees(from: GeoPoint, to: GeoPoint): number {
	const φ1 = toRadians(from.latitude);
	const φ2 = toRadians(to.latitude);
	const Δλ = toRadians(to.longitude - from.longitude);
	const east = Math.sin(Δλ) * Math.cos(φ2);
	const north = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
	return (((toDegrees(Math.atan2(east, north)) % 360) + 360) % 360) % 360;
}

export function greatCirclePoint(from: GeoPoint, to: GeoPoint, fraction: number): GeoPoint {
	const start = unitVector(from);
	const end = unitVector(to);
	const angle = centralAngle(start, end);
	const t = Math.min(1, Math.max(0, fraction));
	if (angle < ANTIPODAL_SINE_EPSILON) {
		return { latitude: from.latitude, longitude: from.longitude };
	}
	if (Math.sin(angle) < ANTIPODAL_SINE_EPSILON) {
		const pole: Vector = Math.abs(start[2]) > 0.999 ? [1, 0, 0] : [0, 0, 1];
		const side = normalize(cross(start, pole));
		const sweep = Math.PI * t;
		return geoPoint([
			start[0] * Math.cos(sweep) + side[0] * Math.sin(sweep),
			start[1] * Math.cos(sweep) + side[1] * Math.sin(sweep),
			start[2] * Math.cos(sweep) + side[2] * Math.sin(sweep)
		]);
	}
	const weightStart = Math.sin((1 - t) * angle) / Math.sin(angle);
	const weightEnd = Math.sin(t * angle) / Math.sin(angle);
	return geoPoint([
		weightStart * start[0] + weightEnd * end[0],
		weightStart * start[1] + weightEnd * end[1],
		weightStart * start[2] + weightEnd * end[2]
	]);
}
