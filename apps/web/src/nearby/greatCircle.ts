import type { Coordinates } from '../api/contract';

/** The IUGG mean radius; the error against the ellipsoid stays under 0.5%, far below what the page shows. */
export const EARTH_RADIUS_KM = 6371.0088;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * The shortest distance over the Earth's surface between two points, by the haversine formula. It
 * only uses the sine of half the longitude difference, so a pair across the antimeridian (179° E
 * and 179° W) is as close as it looks on the globe with no special case.
 */
export function greatCircleDistanceKm(from: Coordinates, to: Coordinates): number {
	const latitudeFrom = toRadians(from.latitude);
	const latitudeTo = toRadians(to.latitude);
	const halfLatitude = (latitudeTo - latitudeFrom) / 2;
	const halfLongitude = toRadians(to.longitude - from.longitude) / 2;

	const a =
		Math.sin(halfLatitude) ** 2 +
		Math.cos(latitudeFrom) * Math.cos(latitudeTo) * Math.sin(halfLongitude) ** 2;

	// Rounding can push `a` a hair past 1 for antipodal points.
	return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
