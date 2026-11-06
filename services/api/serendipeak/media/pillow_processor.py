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
from serendipeak.errors import InfrastructureError

JPEG_MAX_PIXELS = 200_000_000
# PNG and WebP are always decoded in full and conversion keeps several copies alive, so memory
# follows the pixel count: at this cap the worst case measured (an RGBA WebP with a colour
# profile) peaked at about 0.8 GiB of resident memory, and at 50 megapixels it reached 1.4 GiB.
PNG_WEBP_MAX_PIXELS = 25_000_000
# The most pixels held by one decoded JPEG copy. A JPEG is decoded at a reduced scale (see
# _decode) and rejected when even that scale exceeds it, which only a very long and narrow
# photograph does.
DECODE_MAX_PIXELS = 50_000_000
# JPEG stores each side in 16 bits, so a longer rendition cannot be encoded at all.
JPEG_MAX_SIDE = 65_535

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
                transposed = _is_transposed(image)
            except _DECODE_ERRORS as error:
                raise PhotographRejected(PhotographRejection.CORRUPT) from error
            dimensions = _oriented_dimensions(image.size, transposed)
            page_size = _page_size(dimensions)
            viewer_size = _viewer_size(dimensions)
            if max(*page_size, *viewer_size) > JPEG_MAX_SIDE:
                raise PhotographRejected(PhotographRejection.TOO_MANY_PIXELS)

            try:
                working = _decode(image, _covering(page_size, viewer_size), transposed)
            except Image.DecompressionBombError as error:
                raise PhotographRejected(PhotographRejection.TOO_MANY_PIXELS) from error
            except _DECODE_ERRORS as error:
                raise PhotographRejected(PhotographRejection.CORRUPT) from error
            except MemoryError as error:
                raise InfrastructureError("not enough memory to decode the photograph") from error

        # The image decoded and its renditions fit JPEG, so a failure from here on says nothing
        # about the file: it is reported as a processing failure, never as an unexpected error.
        try:
            page_jpeg = _encode(_fit(working, page_size))
            viewer_jpeg = _encode(_fit(working, viewer_size))
        except (*_DECODE_ERRORS, MemoryError) as error:
            raise InfrastructureError("the photograph renditions could not be rendered") from error

        return ProcessedPhotograph(
            format=photograph_format,
            dimensions=dimensions,
            page_jpeg=page_jpeg,
            viewer_jpeg=viewer_jpeg,
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


def _is_transposed(image: Image.Image) -> bool:
    # For a PNG, Pillow decodes the pixels to reach the metadata chunks that may follow them.
    return image.getexif().get(ExifTags.Base.Orientation) in _TRANSPOSED_ORIENTATIONS


def _oriented_dimensions(size: tuple[int, int], transposed: bool) -> ImageDimensions:
    width, height = size
    if transposed:
        width, height = height, width

    return ImageDimensions(width=width, height=height)


def _covering(*sizes: tuple[int, int]) -> tuple[int, int]:
    return max(width for width, _ in sizes), max(height for _, height in sizes)


def _decode(image: Image.Image, oriented_cover: tuple[int, int], transposed: bool) -> Image.Image:
    if image.format in ("JPEG", "MPO"):
        # DCT scaling decodes a JPEG at 1/2, 1/4 or 1/8 of its size while both sides still
        # cover both renditions, so memory follows the renditions instead of the original
        # (about 172 MP for the largest catalog photograph). The request is the renditions'
        # own shape, not a square: a 40000x5000 panorama decodes at 5000x625, where a
        # 2560x2560 request would leave it at full size. The pixels are not turned yet.
        width, height = oriented_cover
        image.draft(None, (height, width) if transposed else (width, height))

    width, height = image.size
    if width * height > DECODE_MAX_PIXELS:
        raise PhotographRejected(PhotographRejection.TOO_MANY_PIXELS)

    image.load()
    # In place, because the copy exif_transpose returns otherwise is one more full-size
    # buffer, and it returns that copy even when the photograph needs no rotation.
    ImageOps.exif_transpose(image, in_place=True)

    return _to_srgb(image)


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
        # convert() copies even when the mode already matches.
        opaque_candidate = image if image.mode == "RGBA" else image.convert("RGBA")
        image = Image.alpha_composite(Image.new("RGBA", image.size, _WHITE), opaque_candidate)

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
