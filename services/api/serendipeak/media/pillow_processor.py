import io
import struct

from PIL import ExifTags, Image, ImageCms, ImageFile, ImageOps, UnidentifiedImageError

from serendipeak.catalog.entities import ImageDimensions
from serendipeak.catalog.errors import PhotographRejected, PhotographRejection
from serendipeak.catalog.media.keys import (
    PAGE_MAX_WIDTH,
    RENDITION_JPEG_QUALITY,
    VIEWER_MAX_LONG_EDGE,
)
from serendipeak.catalog.media.ports import PhotographFormat, ProcessedPhotograph

JPEG_MAX_PIXELS = 200_000_000
PNG_WEBP_MAX_PIXELS = 50_000_000

# Pillow warns above MAX_IMAGE_PIXELS and raises DecompressionBombError above twice that,
# while reading the header. The per-format caps below reject everything over its cap right
# after the header and before any pixel is decoded; this global is the backstop that turns
# absurd headers into an error inside Image.open itself.
Image.MAX_IMAGE_PIXELS = JPEG_MAX_PIXELS
# With this on, Pillow pads a truncated file with gray instead of raising. A truncated upload
# must be rejected, so the default is pinned here and a test fails if anything flips it.
ImageFile.LOAD_TRUNCATED_IMAGES = False

_OPENERS = ("JPEG", "PNG", "WEBP")
# Pillow's JPEG opener reports MPO for a JPEG carrying extra pictures (a phone's depth map or
# preview). Only the primary picture is used, so it is a JPEG photograph, not an animation.
_ACCEPTED_FORMATS = {
    "JPEG": PhotographFormat.JPEG,
    "MPO": PhotographFormat.JPEG,
    "PNG": PhotographFormat.PNG,
    "WEBP": PhotographFormat.WEBP,
}
_MAX_PIXELS = {
    PhotographFormat.JPEG: JPEG_MAX_PIXELS,
    PhotographFormat.PNG: PNG_WEBP_MAX_PIXELS,
    PhotographFormat.WEBP: PNG_WEBP_MAX_PIXELS,
}
_RECOGNIZED_UNSUPPORTED_FORMATS = ("GIF", "TIFF", "BMP", "AVIF")
_TRANSPOSED_ORIENTATIONS = frozenset({5, 6, 7, 8})
_SIXTEEN_BIT_MODES = frozenset({"I", "I;16", "I;16B", "I;16L", "I;16N"})
_COLOUR_MODES = frozenset({"RGB", "RGBA", "L", "LA", "CMYK"})
_ALPHA_MODES = frozenset({"RGBA", "LA", "PA", "RGBa", "La"})
_DECODE_ERRORS = (OSError, SyntaxError, ValueError, EOFError, IndexError, struct.error)
_SRGB = ImageCms.createProfile("sRGB")
_WHITE = (255, 255, 255, 255)


class PillowPhotographProcessor:
    def process(self, data: bytes) -> ProcessedPhotograph:
        photograph_format = _inspect(data)

        with _open(data) as image:
            try:
                dimensions = _oriented_dimensions(image)
                working = _decode(image)
            except Image.DecompressionBombError as error:
                raise PhotographRejected(PhotographRejection.TOO_MANY_PIXELS) from error
            except _DECODE_ERRORS as error:
                raise PhotographRejected(PhotographRejection.CORRUPT) from error

        return ProcessedPhotograph(
            format=photograph_format,
            dimensions=dimensions,
            page_jpeg=_encode(_fit(working, _page_size(dimensions))),
            viewer_jpeg=_encode(_fit(working, _viewer_size(dimensions))),
        )


def _inspect(data: bytes) -> PhotographFormat:
    # verify() leaves the image unusable, so it runs on its own copy and the pixels are decoded
    # from a fresh one. It checks structure only: a JPEG that decodes, even with gray filler
    # where libjpeg recovered from damaged scan data, is accepted. Truncation is what
    # LOAD_TRUNCATED_IMAGES=False turns into an error while decoding.
    with _open(data) as image:
        photograph_format = _ACCEPTED_FORMATS[image.format]
        width, height = image.size
        if width * height > _MAX_PIXELS[photograph_format]:
            raise PhotographRejected(PhotographRejection.TOO_MANY_PIXELS)
        if image.format != "MPO" and getattr(image, "is_animated", False):
            raise PhotographRejected(PhotographRejection.ANIMATED)

        try:
            image.verify()
        except _DECODE_ERRORS as error:
            raise PhotographRejected(PhotographRejection.CORRUPT) from error

    return photograph_format


def _open(data: bytes) -> Image.Image:
    try:
        return Image.open(io.BytesIO(data), formats=_OPENERS)
    except Image.DecompressionBombError as error:
        raise PhotographRejected(PhotographRejection.TOO_MANY_PIXELS) from error
    except UnidentifiedImageError as error:
        reason = (
            PhotographRejection.UNSUPPORTED_FORMAT
            if _is_unsupported_image(data)
            else PhotographRejection.NOT_AN_IMAGE
        )
        raise PhotographRejected(reason) from error
    except _DECODE_ERRORS as error:
        raise PhotographRejected(PhotographRejection.CORRUPT) from error


def _is_unsupported_image(data: bytes) -> bool:
    Image.init()
    recognized = tuple(name for name in _RECOGNIZED_UNSUPPORTED_FORMATS if name in Image.OPEN)

    try:
        with Image.open(io.BytesIO(data), formats=recognized):
            return True
    except Image.DecompressionBombError:
        return True
    except _DECODE_ERRORS:
        return False


def _oriented_dimensions(image: Image.Image) -> ImageDimensions:
    width, height = image.size
    orientation = image.getexif().get(ExifTags.Base.Orientation)
    if orientation in _TRANSPOSED_ORIENTATIONS:
        width, height = height, width

    return ImageDimensions(width=width, height=height)


def _decode(image: Image.Image) -> Image.Image:
    if image.format in ("JPEG", "MPO"):
        # DCT scaling decodes a large JPEG at 1/2, 1/4 or 1/8 of its size while both sides
        # stay at least as large as the viewer rendition, so memory follows the rendition
        # instead of the original (about 172 MP for the largest catalog photograph).
        image.draft(None, (VIEWER_MAX_LONG_EDGE, VIEWER_MAX_LONG_EDGE))
    image.load()

    return _to_srgb(ImageOps.exif_transpose(image))


def _to_srgb(image: Image.Image) -> Image.Image:
    icc_profile = image.info.get("icc_profile")
    has_alpha = image.mode in _ALPHA_MODES or "transparency" in image.info

    if image.mode in _SIXTEEN_BIT_MODES:
        image = image.convert("I").point(lambda value: value / 257).convert("L")
    if image.mode not in _COLOUR_MODES or (has_alpha and image.mode in ("RGB", "L")):
        image = image.convert("RGBA" if has_alpha else "RGB")
    if icc_profile:
        image = _apply_icc_profile(image, icc_profile)
    if image.mode in ("RGBA", "LA"):
        image = Image.alpha_composite(Image.new("RGBA", image.size, _WHITE), image.convert("RGBA"))

    return image.convert("RGB")


def _apply_icc_profile(image: Image.Image, icc_profile: bytes) -> Image.Image:
    output_mode = "RGBA" if image.mode in ("RGBA", "LA") else "RGB"

    # An unreadable profile, or one Little CMS cannot pair with the image mode, leaves the
    # pixels as decoded: the photograph is still usable, only its colour is not managed.
    try:
        source = ImageCms.ImageCmsProfile(io.BytesIO(icc_profile))
        return ImageCms.profileToProfile(image, source, _SRGB, outputMode=output_mode)
    except (ImageCms.PyCMSError, OSError, ValueError):
        return image


def _page_size(dimensions: ImageDimensions) -> tuple[int, int]:
    if dimensions.width <= PAGE_MAX_WIDTH:
        return dimensions.width, dimensions.height

    return _scaled(dimensions, PAGE_MAX_WIDTH / dimensions.width)


def _viewer_size(dimensions: ImageDimensions) -> tuple[int, int]:
    long_edge = max(dimensions.width, dimensions.height)
    if long_edge <= VIEWER_MAX_LONG_EDGE:
        return dimensions.width, dimensions.height

    return _scaled(dimensions, VIEWER_MAX_LONG_EDGE / long_edge)


def _scaled(dimensions: ImageDimensions, factor: float) -> tuple[int, int]:
    return (
        max(1, round(dimensions.width * factor)),
        max(1, round(dimensions.height * factor)),
    )


def _fit(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    if image.size == size:
        return image.copy()

    return image.resize(size, Image.Resampling.LANCZOS, reducing_gap=3.0)


def _encode(image: Image.Image) -> bytes:
    # The JPEG encoder copies a comment from image.info; renditions carry no metadata at all.
    image.info.clear()
    buffer = io.BytesIO()
    image.save(
        buffer,
        format="JPEG",
        quality=RENDITION_JPEG_QUALITY,
        progressive=True,
        optimize=True,
    )

    return buffer.getvalue()
