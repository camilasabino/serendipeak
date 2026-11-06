import io
import os
import struct
import zlib

import pytest
from PIL import ExifTags, Image, ImageCms, ImageFile, JpegImagePlugin

from serendipeak.catalog.entities import ImageDimensions
from serendipeak.catalog.errors import PhotographRejected, PhotographRejection
from serendipeak.catalog.media.ingestion import IngestionLimits, PhotographIngestion
from serendipeak.catalog.media.ports import PhotographFormat
from serendipeak.errors import InfrastructureError
from serendipeak.media.pillow_processor import DECODE_MAX_PIXELS, PillowPhotographProcessor
from tests.support.fakes import FakeMediaStore

PROCESSOR = PillowPhotographProcessor()


def encoded(image, image_format, **options):
    buffer = io.BytesIO()
    image.save(buffer, format=image_format, **options)

    return buffer.getvalue()


def photograph(size=(300, 200), colour=(40, 90, 160), mode="RGB"):
    return Image.new(mode, size, colour)


def noisy_jpeg(size=(400, 300)):
    noise = Image.effect_noise(size, 64).convert("RGB")

    return encoded(noise, "JPEG", quality=95)


def decoded(data):
    image = Image.open(io.BytesIO(data))
    image.load()

    return image


def rejection(data):
    with pytest.raises(PhotographRejected) as rejected:
        PROCESSOR.process(data)

    return rejected.value.reason


def with_jpeg_size(data, width, height):
    start = data.index(b"\xff\xc0") + 5

    return data[:start] + struct.pack(">HH", height, width) + data[start + 4 :]


def with_png_size(data, width, height):
    header = b"IHDR" + struct.pack(">II", width, height) + data[24:29]

    return data[:12] + header + struct.pack(">I", zlib.crc32(header)) + data[33:]


def assert_ratio_kept(size, dimensions):
    width, height = size

    assert abs(width * dimensions.height - height * dimensions.width) <= dimensions.width


@pytest.mark.parametrize(
    ("image_format", "expected"),
    [
        ("JPEG", PhotographFormat.JPEG),
        ("PNG", PhotographFormat.PNG),
        ("WEBP", PhotographFormat.WEBP),
    ],
)
def test_accepts_jpeg_png_and_webp_by_their_decoded_format(image_format, expected):
    processed = PROCESSOR.process(encoded(photograph(), image_format))

    assert processed.format is expected
    assert processed.dimensions == ImageDimensions(width=300, height=200)


def test_a_jpeg_with_extra_pictures_is_a_jpeg_photograph():
    data = encoded(
        photograph(),
        "MPO",
        save_all=True,
        append_images=[photograph((150, 100), (200, 0, 0))],
    )

    processed = PROCESSOR.process(data)

    assert processed.format is PhotographFormat.JPEG
    assert processed.dimensions == ImageDimensions(width=300, height=200)


@pytest.mark.parametrize("image_format", ["JPEG", "PNG", "WEBP"])
def test_renditions_are_progressive_8_bit_rgb_jpegs(image_format):
    processed = PROCESSOR.process(encoded(photograph(), image_format))

    for rendition in (processed.page_jpeg, processed.viewer_jpeg):
        image = decoded(rendition)
        assert image.format == "JPEG"
        assert image.mode == "RGB"
        assert image.info.get("progressive")


def test_exif_orientation_6_swaps_the_dimensions_and_turns_the_pixels():
    stored = photograph((300, 200), (220, 0, 0))
    stored.paste((0, 0, 220), (150, 0, 300, 200))
    exif = Image.Exif()
    exif[ExifTags.Base.Orientation] = 6

    processed = PROCESSOR.process(encoded(stored, "JPEG", exif=exif.tobytes()))

    assert processed.dimensions == ImageDimensions(width=200, height=300)
    viewer = decoded(processed.viewer_jpeg)
    assert viewer.size == (200, 300)
    top_red, _, top_blue = viewer.getpixel((100, 20))
    bottom_red, _, bottom_blue = viewer.getpixel((100, 280))
    assert top_red > 180 and top_blue < 60
    assert bottom_blue > 180 and bottom_red < 60


def test_renditions_carry_no_exif_gps_icc_xmp_or_comment():
    exif = Image.Exif()
    exif[ExifTags.Base.Make] = "Camera maker"
    exif[ExifTags.IFD.GPSInfo] = {
        ExifTags.GPS.GPSLatitudeRef: "S",
        ExifTags.GPS.GPSLatitude: (32.0, 39.0, 11.0),
    }
    xmp = b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>'
    srgb = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    data = encoded(
        photograph(),
        "JPEG",
        exif=exif.tobytes(),
        icc_profile=srgb,
        comment=b"private comment",
        xmp=xmp,
    )
    assert b"Exif" in data and b"private comment" in data

    processed = PROCESSOR.process(data)

    for rendition in (processed.page_jpeg, processed.viewer_jpeg):
        image = decoded(rendition)
        assert not image.getexif()
        assert {"exif", "icc_profile", "xmp", "comment"}.isdisjoint(image.info)
        for marker in (b"Exif", b"Camera maker", b"private comment", b"xmpmeta", b"ICC_PROFILE"):
            assert marker not in rendition


def test_cmyk_becomes_rgb():
    cyan = photograph(mode="CMYK", colour=(255, 0, 0, 0))

    processed = PROCESSOR.process(encoded(cyan, "JPEG", quality=95))

    red, green, blue = decoded(processed.page_jpeg).getpixel((150, 100))
    assert red < 40 and green > 200 and blue > 200


def test_an_embedded_srgb_profile_keeps_the_colours():
    srgb = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()

    processed = PROCESSOR.process(encoded(photograph(), "PNG", icc_profile=srgb))

    pixel = decoded(processed.page_jpeg).getpixel((150, 100))
    assert all(abs(got - want) <= 3 for got, want in zip(pixel, (40, 90, 160), strict=True))


def test_an_unreadable_colour_profile_does_not_reject_the_photograph():
    processed = PROCESSOR.process(encoded(photograph(), "PNG", icc_profile=b"not a profile"))

    assert processed.dimensions == ImageDimensions(width=300, height=200)


def test_transparency_is_flattened_onto_white():
    image = photograph(mode="RGBA", colour=(0, 0, 0, 0))
    image.paste((200, 0, 0, 255), (0, 0, 150, 200))

    processed = PROCESSOR.process(encoded(image, "PNG"))

    rendition = decoded(processed.page_jpeg)
    assert all(channel >= 250 for channel in rendition.getpixel((250, 100)))
    red, green, blue = rendition.getpixel((50, 100))
    assert red > 180 and green < 40 and blue < 40


def test_a_palette_with_a_transparent_index_is_flattened_onto_white():
    image = Image.new("P", (40, 30), 0)
    image.putpalette([0, 0, 0, 255, 0, 0])

    processed = PROCESSOR.process(encoded(image, "PNG", transparency=0))

    assert all(channel >= 250 for channel in decoded(processed.page_jpeg).getpixel((20, 15)))


def test_a_16_bit_greyscale_png_is_scaled_to_8_bits():
    processed = PROCESSOR.process(encoded(Image.new("I;16", (40, 30), 32768), "PNG"))

    red, green, blue = decoded(processed.page_jpeg).getpixel((20, 15))
    assert 120 <= red <= 135 and red == green == blue


@pytest.mark.parametrize(
    "data",
    [b"", os.urandom(4096), b"%PDF-1.7\n", b'<svg xmlns="http://www.w3.org/2000/svg"/>'],
    ids=["empty", "random", "pdf", "svg"],
)
def test_bytes_that_are_no_image_are_rejected(data):
    assert rejection(data) is PhotographRejection.NOT_AN_IMAGE


@pytest.mark.parametrize("image_format", ["GIF", "TIFF", "BMP"])
def test_other_image_formats_are_unsupported(image_format):
    assert rejection(encoded(photograph(), image_format)) is PhotographRejection.UNSUPPORTED_FORMAT


@pytest.mark.parametrize("image_format", ["WEBP", "PNG"])
def test_animated_images_are_rejected(image_format):
    frames = [photograph(colour=(0, 0, 0)), photograph(colour=(255, 255, 255))]
    data = encoded(frames[0], image_format, save_all=True, append_images=frames[1:])

    assert rejection(data) is PhotographRejection.ANIMATED


def test_pillow_is_never_told_to_load_truncated_images():
    PROCESSOR.process(encoded(photograph(), "JPEG"))

    assert ImageFile.LOAD_TRUNCATED_IMAGES is False


@pytest.mark.parametrize("kept", [0.25, 0.5, 0.9])
def test_a_truncated_jpeg_is_corrupt(kept):
    data = noisy_jpeg()

    assert rejection(data[: int(len(data) * kept)]) is PhotographRejection.CORRUPT


def test_a_jpeg_with_a_damaged_scan_that_libjpeg_completes_is_accepted():
    # Known limitation: libjpeg recovers a short scan by filling the rest with gray, and Pillow
    # does not report it. Ingestion rejects what Pillow rejects and claims nothing beyond that.
    data = with_jpeg_size(noisy_jpeg((64, 64)), 64, 4_000)

    processed = PROCESSOR.process(data)

    assert processed.dimensions == ImageDimensions(width=64, height=4_000)


def test_a_png_with_damaged_pixel_data_is_corrupt():
    data = bytearray(encoded(Image.effect_noise((200, 150), 64), "PNG"))
    start = data.index(b"IDAT") + 40
    data[start : start + 64] = bytes(64)

    assert rejection(bytes(data)) is PhotographRejection.CORRUPT


def test_a_png_with_fewer_pixels_than_its_header_declares_is_corrupt():
    # The chunks are valid, so verify() passes; reading the metadata is what decodes the pixels
    # first, and it must be refused like any other damaged file instead of escaping as OSError.
    data = with_png_size(encoded(photograph((1, 1)), "PNG"), 5_000, 5_000)

    assert rejection(data) is PhotographRejection.CORRUPT


@pytest.mark.parametrize(("width", "height"), [(10_000, 10_000), (5_001, 5_000)])
def test_a_png_header_over_25_megapixels_is_rejected_before_decoding(width, height):
    data = with_png_size(encoded(photograph((1, 1)), "PNG"), width, height)

    assert rejection(data) is PhotographRejection.TOO_MANY_PIXELS


@pytest.mark.filterwarnings("ignore::PIL.Image.DecompressionBombWarning")
@pytest.mark.parametrize(("width", "height"), [(20_000, 15_000), (30_000, 30_000)])
def test_a_jpeg_header_over_200_megapixels_is_rejected_before_decoding(width, height):
    data = with_jpeg_size(encoded(photograph((16, 16)), "JPEG"), width, height)

    assert rejection(data) is PhotographRejection.TOO_MANY_PIXELS


def test_a_jpeg_header_under_200_megapixels_passes_the_pixel_cap():
    data = with_jpeg_size(encoded(photograph((16, 16)), "JPEG"), 12_000, 12_000)

    processed = PROCESSOR.process(data)

    assert processed.dimensions == ImageDimensions(width=12_000, height=12_000)
    assert decoded(processed.viewer_jpeg).size == (2560, 2560)


def test_a_large_jpeg_is_decoded_at_a_reduced_scale_into_full_size_renditions():
    processed = PROCESSOR.process(encoded(photograph((5200, 5200)), "JPEG"))

    assert processed.dimensions == ImageDimensions(width=5200, height=5200)
    assert decoded(processed.viewer_jpeg).size == (2560, 2560)
    assert decoded(processed.page_jpeg).size == (1280, 1280)


@pytest.fixture
def decoded_sizes(monkeypatch):
    """The size each JPEG is decoded at, which is what bounds the decoding memory."""
    sizes = []
    load = JpegImagePlugin.JpegImageFile.load

    def recording_load(image):
        if image.tile:
            sizes.append(image.size)
        return load(image)

    monkeypatch.setattr(JpegImagePlugin.JpegImageFile, "load", recording_load)

    return sizes


def oriented_jpeg(width, height, orientation=None):
    exif = Image.Exif()
    if orientation is not None:
        exif[ExifTags.Base.Orientation] = orientation

    return with_jpeg_size(encoded(photograph((16, 16)), "JPEG", exif=exif.tobytes()), width, height)


@pytest.mark.parametrize(
    ("stored", "orientation", "dimensions", "page", "viewer", "decoded_at"),
    [
        ((40_000, 5_000), None, (40_000, 5_000), (1280, 160), (2560, 320), (5_000, 625)),
        ((5_000, 40_000), None, (5_000, 40_000), (1280, 10240), (320, 2560), (2_500, 20_000)),
        ((40_000, 5_000), 6, (5_000, 40_000), (1280, 10240), (320, 2560), (20_000, 2_500)),
    ],
)
def test_a_panorama_is_decoded_at_the_scale_its_renditions_need(
    decoded_sizes, stored, orientation, dimensions, page, viewer, decoded_at
):
    processed = PROCESSOR.process(oriented_jpeg(*stored, orientation))

    assert processed.dimensions == ImageDimensions(*dimensions)
    assert set(decoded_sizes) == {decoded_at}
    assert decoded_at[0] * decoded_at[1] <= DECODE_MAX_PIXELS
    assert decoded(processed.page_jpeg).size == page
    assert decoded(processed.viewer_jpeg).size == viewer


def test_a_jpeg_that_cannot_be_decoded_small_enough_is_rejected_before_decoding(decoded_sizes):
    # Its page rendition keeps the full 60000 pixels of height, so no DCT scale applies.
    data = oriented_jpeg(1_500, 60_000)

    assert rejection(data) is PhotographRejection.TOO_MANY_PIXELS
    assert decoded_sizes == []


def test_a_photograph_whose_rendition_jpeg_cannot_hold_is_rejected():
    data = encoded(photograph((1, 70_000)), "PNG")

    assert rejection(data) is PhotographRejection.TOO_MANY_PIXELS


@pytest.mark.parametrize("failing", ["resize", "save"])
def test_a_rendering_failure_is_a_processing_failure_not_a_pillow_error(monkeypatch, failing):
    data = encoded(photograph((3000, 2000)), "PNG")

    def fail(*args, **kwargs):
        raise OSError("encoder error -2")

    monkeypatch.setattr(Image.Image, failing, fail)

    with pytest.raises(InfrastructureError):
        PROCESSOR.process(data)


def test_running_out_of_memory_while_decoding_is_a_processing_failure(monkeypatch):
    def fail(image):
        raise MemoryError

    monkeypatch.setattr(JpegImagePlugin.JpegImageFile, "load", fail)

    with pytest.raises(InfrastructureError):
        PROCESSOR.process(encoded(photograph(), "JPEG"))


@pytest.mark.parametrize(
    ("size", "page", "viewer"),
    [
        ((3000, 2000), (1280, 853), (2560, 1707)),
        ((2000, 3000), (1280, 1920), (1707, 2560)),
        ((1000, 4000), (1000, 4000), (640, 2560)),
        ((2400, 900), (1280, 480), (2400, 900)),
        ((800, 600), (800, 600), (800, 600)),
        ((1, 1), (1, 1), (1, 1)),
    ],
)
def test_renditions_fit_their_bounds_keep_the_ratio_and_are_never_upscaled(size, page, viewer):
    processed = PROCESSOR.process(encoded(photograph(size), "PNG"))

    dimensions = processed.dimensions
    page_size = decoded(processed.page_jpeg).size
    viewer_size = decoded(processed.viewer_jpeg).size
    assert dimensions == ImageDimensions(*size)
    assert (page_size, viewer_size) == (page, viewer)
    assert page_size[0] <= 1280 and max(viewer_size) <= 2560
    assert page_size[0] <= size[0] and viewer_size[0] <= size[0]
    assert_ratio_kept(page_size, dimensions)
    assert_ratio_kept(viewer_size, dimensions)


def test_ingestion_rejects_bytes_over_its_limit_before_decoding():
    data = encoded(photograph(), "PNG")
    store = FakeMediaStore()
    ingestion = PhotographIngestion(PROCESSOR, store, IngestionLimits(max_bytes=len(data) - 1))

    with pytest.raises(PhotographRejected) as rejected:
        ingestion.prepare(data)

    assert rejected.value.reason is PhotographRejection.TOO_MANY_BYTES
    assert store.calls == []


def test_pillow_errors_never_cross_the_adapter():
    for data in (noisy_jpeg()[:300], b"\x89PNG\r\n\x1a\n" + bytes(40), b"RIFF\x00\x00\x00\x00WEBP"):
        with pytest.raises(PhotographRejected):
            PROCESSOR.process(data)
