from serendipeak.catalog.get_mountain_form_options import GetMountainFormOptions
from tests.support.fakes import InMemoryGeographyOptionsReader
from tests.support.geography import reference
from tests.support.regions import region_path, regions_of


def execute(*paths):
    return GetMountainFormOptions(InMemoryGeographyOptionsReader(regions_of(*paths))).execute()


def test_continents_and_countries_come_by_english_name():
    options = execute()

    continent_names = [continent.name.en for continent in options.continents]
    country_names = [country.name.en for country in options.countries]
    assert continent_names == sorted(continent_names)
    assert country_names == sorted(country_names)
    assert len(options.continents) == len(reference().continents)
    assert len(options.countries) == len(reference().countries)


def test_regions_follow_the_tree_each_labelled_with_its_path():
    options = execute(
        region_path("Andes", "Southern Andes"),
        region_path("Andes", "Central Andes"),
        region_path("Alps"),
    )

    assert [region.label for region in options.regions] == [
        "Alps",
        "Andes",
        "Andes › Central Andes",
        "Andes › Southern Andes",
    ]


def test_two_regions_with_one_path_are_told_apart_by_slug():
    first = region_path("Sierra Nevada")
    second = region_path("Sierra Nevada")
    second = type(second)(
        region=type(second.region)(slug="sierra-nevada-es", name=second.region.name), ancestors=()
    )

    options = execute(first, second)

    assert sorted(region.label for region in options.regions) == [
        "Sierra Nevada (sierra-nevada)",
        "Sierra Nevada (sierra-nevada-es)",
    ]
