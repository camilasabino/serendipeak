export interface CameraFraming {
	x: number;
	y: number;
}

export interface SummitOffset {
	x: number;
	y: number;
	z: number;
}

export interface LookAxes {
	direction: SummitOffset;
	up: SummitOffset;
	right: SummitOffset;
}

export const CESIUM_DEFAULT_FOV_RADIANS = Math.PI / 3;
export const CENTERED_FRAMING: CameraFraming = { x: 0, y: 0 };

export function resolvedFraming(framing?: CameraFraming): CameraFraming {
	return framing ?? CENTERED_FRAMING;
}

export function cesiumVerticalFovRadians(fovRadians: number, aspect: number): number {
	if (!(aspect > 0) || !Number.isFinite(fovRadians)) {
		return Number.NaN;
	}
	if (aspect <= 1) {
		return fovRadians;
	}
	return Math.atan(Math.tan(fovRadians * 0.5) / aspect) * 2;
}

export function cameraOffsetFromPose(
	headingDegrees: number,
	pitchDegrees: number,
	rangeMeters: number
): SummitOffset {
	const standpoint = (((headingDegrees + 180) % 360) * Math.PI) / 180;
	const pitch = (pitchDegrees * Math.PI) / 180;
	const horizontal = Math.cos(pitch) * rangeMeters;
	return {
		x: Math.sin(standpoint) * horizontal,
		y: Math.cos(standpoint) * horizontal,
		z: -Math.sin(pitch) * rangeMeters
	};
}

export function lookAxesForFraming(
	cameraFromSummit: SummitOffset,
	framing: CameraFraming,
	verticalFovRadians: number,
	aspect: number
): LookAxes | undefined {
	const halfY = Math.tan(verticalFovRadians / 2);
	const halfX = halfY * aspect;
	if (!(halfX > 0) || !(halfY > 0)) {
		return undefined;
	}
	const toSummit = {
		x: -cameraFromSummit.x,
		y: -cameraFromSummit.y,
		z: -cameraFromSummit.z
	};
	if (Math.hypot(toSummit.x, toSummit.y, toSummit.z) < 1e-6) {
		return undefined;
	}

	const sx = framing.x * halfX;
	const sy = framing.y * halfY;
	const rayLength = Math.hypot(1, sx, sy);
	const amplitude = Math.hypot(1, sy);
	const distance = Math.hypot(toSummit.x, toSummit.y, toSummit.z);
	const sineArg = (rayLength * (toSummit.z / distance)) / amplitude;
	if (!Number.isFinite(sineArg) || Math.abs(sineArg) > 1 + 1e-8) {
		return undefined;
	}
	const clamped = Math.min(1, Math.max(-1, sineArg));
	const shift = Math.atan(sy);
	const base = Math.asin(clamped);
	const pitches = [base - shift, Math.PI - base - shift];
	const bearing = Math.atan2(toSummit.x, toSummit.y);

	let best: { axes: LookAxes; error: number } | undefined;
	for (const pitch of pitches) {
		const cosine = Math.cos(pitch);
		const sine = Math.sin(pitch);
		const lateral = cosine - sy * sine;
		const heading = bearing - Math.atan2(sx, lateral);
		const forward = {
			x: Math.sin(heading) * cosine,
			y: Math.cos(heading) * cosine,
			z: sine
		};
		const axes = axesFromForward(forward);
		if (!axes) {
			continue;
		}
		const projected = projectSummitNormalized(cameraFromSummit, axes, verticalFovRadians, aspect);
		if (!projected) {
			continue;
		}
		const error = Math.hypot(projected.x - framing.x, projected.y - framing.y);
		if (!best || error < best.error) {
			best = { axes, error };
		}
	}
	if (!best || best.error > 1e-6) {
		return undefined;
	}
	return best.axes;
}

export function projectSummitNormalized(
	cameraFromSummit: SummitOffset,
	axes: LookAxes,
	verticalFovRadians: number,
	aspect: number
): CameraFraming | undefined {
	const halfY = Math.tan(verticalFovRadians / 2);
	const halfX = halfY * aspect;
	if (!(halfX > 0) || !(halfY > 0)) {
		return undefined;
	}
	const toSummit = {
		x: -cameraFromSummit.x,
		y: -cameraFromSummit.y,
		z: -cameraFromSummit.z
	};
	const depth = dot(toSummit, axes.direction);
	if (!(depth > 1e-8)) {
		return undefined;
	}
	const x = dot(toSummit, axes.right) / depth / halfX;
	const y = dot(toSummit, axes.up) / depth / halfY;
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		return undefined;
	}
	return { x, y };
}

function axesFromForward(forward: SummitOffset): LookAxes | undefined {
	const length = Math.hypot(forward.x, forward.y, forward.z);
	if (!(length > 0)) {
		return undefined;
	}
	const direction = {
		x: forward.x / length,
		y: forward.y / length,
		z: forward.z / length
	};
	const rightRaw = { x: direction.y, y: -direction.x, z: 0 };
	const rightLength = Math.hypot(rightRaw.x, rightRaw.y, rightRaw.z);
	if (rightLength < 1e-8) {
		return undefined;
	}
	const right = {
		x: rightRaw.x / rightLength,
		y: rightRaw.y / rightLength,
		z: 0
	};
	const up = {
		x: right.y * direction.z - right.z * direction.y,
		y: right.z * direction.x - right.x * direction.z,
		z: right.x * direction.y - right.y * direction.x
	};
	return { direction, up, right };
}

function dot(a: SummitOffset, b: SummitOffset): number {
	return a.x * b.x + a.y * b.y + a.z * b.z;
}
