from dataclasses import replace

from serendipeak.catalog.bootstrap.ports import CatalogMountain, CatalogSeed
from serendipeak.catalog.bootstrap.seed import PENDING_CONTINENT
from serendipeak.catalog.errors import GeographyBackfillRejected
from serendipeak.catalog.geography import GeographyReference
from serendipeak.catalog.geography_input import GeographyInput, StoredGeography, plan_backfill


def assign_geography(
    seed: CatalogSeed,
    geography: GeographyInput,
    reference: GeographyReference,
) -> CatalogSeed:
    """Give every seed mountain the continent and countries of the geography input.

    The input has to cover every seed mountain once, and its countries have to agree with the
    seed's v1 names, which is what plan_backfill judges for a stored catalog. Entries of
    mountains the seed does not have are ignored: the input also covers mountains created after
    the seed.
    """
    seed_ids = {entry.mountain.id for entry in seed.mountains}
    covered = replace(
        geography,
        mountains=tuple(entry for entry in geography.mountains if entry.id in seed_ids),
    )
    plan_backfill(
        covered,
        [
            StoredGeography(
                id=entry.mountain.id,
                slug=entry.mountain.slug,
                legacy_country_names=tuple(seed.legacy_country_names.get(entry.mountain.id, ())),
                continent_code=None,
                country_codes=(),
            )
            for entry in seed.mountains
        ],
        frozenset(reference.countries),
    )

    assigned = {entry.id: entry for entry in covered.mountains}
    mountains = tuple(
        _assigned(entry, assigned[entry.mountain.id], reference) for entry in seed.mountains
    )

    return replace(seed, mountains=mountains)


def without_geography(entry: CatalogMountain) -> CatalogMountain:
    return replace(
        entry, mountain=replace(entry.mountain, continent=PENDING_CONTINENT, countries=())
    )


def _assigned(entry, assignment, reference):
    continent = reference.continents.get(assignment.continent_code)
    if continent is None:
        raise GeographyBackfillRejected(
            (f"{assignment.slug}: continent {assignment.continent_code} is not in the reference",)
        )

    countries = sorted(
        (reference.countries[code] for code in assignment.country_codes),
        key=lambda country: (country.name.en, country.code),
    )

    return replace(
        entry,
        mountain=replace(entry.mountain, continent=continent, countries=tuple(countries)),
    )
