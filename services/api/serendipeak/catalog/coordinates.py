LATITUDE_MIN_DEGREES = -90.0
LATITUDE_MAX_DEGREES = 90.0

LONGITUDE_MIN_DEGREES = -180.0
LONGITUDE_MAX_DEGREES = 180.0


def coordinates_in_range(latitude: float, longitude: float) -> bool:
    return (
        LATITUDE_MIN_DEGREES <= latitude <= LATITUDE_MAX_DEGREES
        and LONGITUDE_MIN_DEGREES <= longitude <= LONGITUDE_MAX_DEGREES
    )
