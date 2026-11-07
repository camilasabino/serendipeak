"""Generate the reference-data migrations for continents and countries.

Standard library only. The inputs are data files an operator downloads once (see the README
section "Reference data"); nothing is fetched here, and the same inputs always produce the same
files. Adopting a newer CLDR or ISO release means changing the pins below and generating new
migrations, reviewed like these.
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

CLDR_VERSION = "49.0.0"
# The npm tarballs the data files come from, by their registry integrity.
CLDR_PACKAGES = {
    "cldr-core": (
        "sha512-2Z2dYeDO95AbKIG9dIUdZy6DD4f0hhHjTYnaHZj/9JTQ82pX5EsJlCs2BXPWi4vd1d98MwotOivh4Uthxwri4A=="
    ),
    "cldr-localenames-full": (
        "sha512-nTBCysDVK+JHb2hPhb26fJGp9+Lw0mOiqVsJ/9aTEQIduBTnghTSLgZitsM7FLa1Vjr0K0hfBQMdBgoyDxK0nQ=="
    ),
}
LOCALES = ("en", "es", "pt")
ISO_CODES_VERSION = "4.20.1"
ISO_CODES_SHA256 = "f01b812b57fba9f31ff621bf33e7c7570a01964dbeb5be2167e94decf538c89f"
ISO_CODES_URL = (
    "https://salsa.debian.org/iso-codes-team/iso-codes/-/raw/"
    f"v{ISO_CODES_VERSION}/data/iso_3166-1.json"
)
EXPECTED_COUNTRIES = 249

# The seven continents: code, CLDR territory (UN M49 region) its names come from.
CONTINENTS = (
    ("AF", "002"),
    ("AN", "AQ"),
    ("AS", "142"),
    ("EU", "150"),
    ("NA", "003"),
    ("OC", "009"),
    ("SA", "005"),
)
# The M49 regions whose countries belong to each continent. The Americas are split in two.
CONTAINMENT_ROOTS = {
    "AF": ("002",),
    "AS": ("142",),
    "EU": ("150",),
    "NA": ("021", "013", "029"),
    "OC": ("009",),
    "SA": ("005",),
}
# CLDR places Antarctica in "Outlying Oceania"; it is the one continent override.
CONTINENT_OVERRIDES = {"AQ": "AN"}
# Name overrides: (code, language, CLDR value, chosen value, reason). None of the CLDR values has
# been rejected by the owner, so the list is empty and every name is CLDR's.
NAME_OVERRIDES: tuple[tuple[str, str, str, str, str], ...] = ()

CONTINENT_MIGRATION = "0015_continent_reference.py"
COUNTRY_MIGRATION = "0016_country_reference.py"
GENERATED_COMMAND = (
    "uv run python tools/generate_geography_reference.py --cldr-core <cldr-core {version}>"
    " --cldr-names <cldr-localenames-full {version}> --iso-codes <iso_3166-1.json>"
    " --retrieved-on {retrieved_on} --output-dir serendipeak/persistence/migrations"
)


class ReferenceDataError(Exception):
    pass


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cldr-core", type=Path, required=True, help="cldr-core package directory")
    parser.add_argument(
        "--cldr-names", type=Path, required=True, help="cldr-localenames-full package directory"
    )
    parser.add_argument("--iso-codes", type=Path, required=True, help="iso_3166-1.json")
    parser.add_argument("--retrieved-on", required=True, help="date the inputs were downloaded")
    parser.add_argument("--output-dir", type=Path, required=True, help="the migrations directory")
    arguments = parser.parse_args(argv)

    try:
        files = generate(
            cldr_core=arguments.cldr_core,
            cldr_names=arguments.cldr_names,
            iso_codes=arguments.iso_codes,
            retrieved_on=arguments.retrieved_on,
        )
    except ReferenceDataError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    for name, content in files.items():
        (arguments.output_dir / name).write_text(content, encoding="utf-8")
        print(f"wrote {arguments.output_dir / name}")

    return 0


def generate(*, cldr_core, cldr_names, iso_codes, retrieved_on):
    """Return the migration files, by name, for the given inputs."""
    _check_package(cldr_core, "cldr-core")
    _check_package(cldr_names, "cldr-localenames-full")
    territories = {locale: _territories(cldr_names, locale) for locale in LOCALES}
    codes = _iso_codes(iso_codes)
    _check_names_exist(territories, codes)
    continent_of = _continents_of_countries(cldr_core, codes)
    overridden = _apply_name_overrides(territories)

    continents = [
        (code, *(territories[locale][region] for locale in LOCALES)) for code, region in CONTINENTS
    ]
    countries = [
        (code, *(territories[locale][code] for locale in LOCALES), continent_of[code])
        for code in codes
    ]
    _check_names(continents, countries)

    header = _header(retrieved_on, overridden)

    return {
        CONTINENT_MIGRATION: _continent_migration(header, continents),
        COUNTRY_MIGRATION: _country_migration(header, countries),
    }


def _check_package(directory, name):
    package = _read_json(directory / "package.json")
    if package.get("name") != name or package.get("version") != CLDR_VERSION:
        raise ReferenceDataError(f"{directory} is not {name} {CLDR_VERSION}")


def _territories(cldr_names, locale):
    document = _read_json(cldr_names / "main" / locale / "territories.json")

    return document["main"][locale]["localeDisplayNames"]["territories"]


def _iso_codes(path):
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != ISO_CODES_SHA256:
        raise ReferenceDataError(f"{path} is not iso-codes {ISO_CODES_VERSION} iso_3166-1.json")

    codes = sorted(entry["alpha_2"] for entry in json.loads(content)["3166-1"])
    if len(codes) != EXPECTED_COUNTRIES or len(set(codes)) != len(codes):
        raise ReferenceDataError(f"expected {EXPECTED_COUNTRIES} unique codes, found {len(codes)}")

    return codes


def _check_names_exist(territories, codes):
    wanted = [*codes, *(region for _, region in CONTINENTS)]
    for locale in LOCALES:
        missing = [code for code in wanted if code not in territories[locale]]
        if missing:
            raise ReferenceDataError(f"CLDR has no {locale} name for {', '.join(missing)}")


def _continents_of_countries(cldr_core, codes):
    containment = _read_json(cldr_core / "supplemental" / "territoryContainment.json")[
        "supplemental"
    ]["territoryContainment"]

    def members(region):
        found = set()
        for child in containment.get(region, {}).get("_contains", []):
            found |= members(child) if child in containment else {child}
        return found

    continent_of = {}
    for continent, roots in CONTAINMENT_ROOTS.items():
        for root in roots:
            for code in members(root):
                continent_of.setdefault(code, []).append(continent)
    continent_of.update({code: [continent] for code, continent in CONTINENT_OVERRIDES.items()})

    missing = [code for code in codes if code not in continent_of]
    ambiguous = [code for code in codes if len(continent_of.get(code, ())) > 1]
    if missing or ambiguous:
        raise ReferenceDataError(
            f"codes without exactly one continent: missing {missing}, ambiguous {ambiguous}"
        )

    return {code: continent_of[code][0] for code in codes}


def _apply_name_overrides(territories):
    for code, language, cldr_value, chosen, _reason in NAME_OVERRIDES:
        if territories[language][code] != cldr_value:
            raise ReferenceDataError(f"override of {code} ({language}) names another CLDR value")
        territories[language][code] = chosen

    return NAME_OVERRIDES


def _check_names(continents, countries):
    for row in (*continents, *countries):
        if any(not name.strip() or name != name.strip() for name in row[1:4]):
            raise ReferenceDataError(f"{row[0]} has a blank or untrimmed name")
    for label, rows in (("continent", continents), ("country", countries)):
        english = [row[1] for row in rows]
        if len(set(english)) != len(english):
            raise ReferenceDataError(f"English {label} names are not unique")


def _read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ReferenceDataError(f"cannot read {path}: {error}") from error


def _header(retrieved_on, overrides):
    override_lines = (
        ["# Name overrides: none. Every name is the CLDR value."]
        if not overrides
        else [
            "# Name overrides (code, language, CLDR value, chosen value, reason):",
            *(f"#   {entry!r}" for entry in overrides),
        ]
    )
    command = GENERATED_COMMAND.format(version=CLDR_VERSION, retrieved_on=retrieved_on).split(" --")
    command = [command[0], *(f"--{option}" for option in command[1:])]

    return "\n".join(
        [
            "# Reference data: generated, immutable once applied. Do not edit by hand.",
            "#",
            f"# Names: Unicode CLDR {CLDR_VERSION}, locales {', '.join(LOCALES)}, territory",
            "# display names in their standard form, from the npm packages",
            f"# cldr-core@{CLDR_VERSION}",
            f"#   {CLDR_PACKAGES['cldr-core']}",
            f"# cldr-localenames-full@{CLDR_VERSION}",
            f"#   {CLDR_PACKAGES['cldr-localenames-full']}",
            "# Country codes: the 249 officially assigned ISO 3166-1 alpha-2 codes, as listed by",
            f"# Debian iso-codes {ISO_CODES_VERSION}, data/iso_3166-1.json",
            f"#   sha256 {ISO_CODES_SHA256}",
            f"#   {ISO_CODES_URL}",
            "# Reference continent of a country: its UN M49 region in CLDR's territoryContainment,",
            "# with the Americas split into South America and the rest, and AQ set to AN.",
            *override_lines,
            f"# Inputs downloaded on {retrieved_on}.",
            "# Generator:",
            *(f"#   {line}" for line in command),
        ]
    )


def _literal(value):
    return json.dumps(value, ensure_ascii=False)


def _rows(name, rows):
    lines = [f"{name} = ("]
    for row in rows:
        line = f"    ({', '.join(_literal(value) for value in row)}),"
        if len(line) <= 100:
            lines.append(line)
        else:
            lines.append("    (")
            lines.extend(f"        {_literal(value)}," for value in row)
            lines.append("    ),")
    lines.append(")")

    return "\n".join(lines)


def _continent_migration(header, continents):
    return (
        CONTINENT_TEMPLATE.replace("@@HEADER@@", header)
        .replace("@@ROWS@@", _rows("CONTINENTS", continents))
        .replace("@@PREVIOUS@@", PREVIOUS_MIGRATION)
    )


def _country_migration(header, countries):
    return CONTINENT_FOLLOWER_TEMPLATE.replace("@@HEADER@@", header).replace(
        "@@ROWS@@", _rows("COUNTRIES", countries)
    )


PREVIOUS_MIGRATION = "0014_localized_mountain_text"

CONTINENT_TEMPLATE = """@@HEADER@@

from django.db import migrations, models

@@ROWS@@


def load_continents(apps, schema_editor):
    continent = apps.get_model("catalog", "ContinentRecord")
    continent.objects.using(schema_editor.connection.alias).bulk_create(
        continent(code=code, name_en=name_en, name_es=name_es, name_pt=name_pt)
        for code, name_en, name_es, name_pt in CONTINENTS
    )


class Migration(migrations.Migration):
    dependencies = [("catalog", "@@PREVIOUS@@")]

    operations = [
        migrations.CreateModel(
            name="ContinentRecord",
            fields=[
                ("code", models.TextField(primary_key=True, serialize=False)),
                ("name_en", models.TextField()),
                ("name_es", models.TextField()),
                ("name_pt", models.TextField()),
            ],
            options={
                "db_table": "continent",
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(
                            ("code__in", ("AF", "AN", "AS", "EU", "NA", "OC", "SA"))
                        ),
                        name="continent_code_valid",
                    ),
                    models.UniqueConstraint(fields=("name_en",), name="continent_name_en_key"),
                    models.CheckConstraint(
                        condition=models.Q(("name_en__regex", "\\\\S")),
                        name="continent_name_en_not_blank",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("name_es__regex", "\\\\S")),
                        name="continent_name_es_not_blank",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("name_pt__regex", "\\\\S")),
                        name="continent_name_pt_not_blank",
                    ),
                ],
            },
        ),
        migrations.RunPython(load_continents, migrations.RunPython.noop),
    ]
"""

CONTINENT_FOLLOWER_TEMPLATE = """@@HEADER@@

import django.db.models.deletion
from django.db import migrations, models

@@ROWS@@


def load_countries(apps, schema_editor):
    country = apps.get_model("catalog", "CountryRecord")
    country.objects.using(schema_editor.connection.alias).bulk_create(
        country(
            code=code,
            name_en=name_en,
            name_es=name_es,
            name_pt=name_pt,
            continent_id=continent_code,
        )
        for code, name_en, name_es, name_pt, continent_code in COUNTRIES
    )


class Migration(migrations.Migration):
    dependencies = [("catalog", "0015_continent_reference")]

    operations = [
        migrations.CreateModel(
            name="CountryRecord",
            fields=[
                ("code", models.TextField(primary_key=True, serialize=False)),
                ("name_en", models.TextField()),
                ("name_es", models.TextField()),
                ("name_pt", models.TextField()),
                (
                    "continent",
                    models.ForeignKey(
                        db_column="continent_code",
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="countries",
                        to="catalog.continentrecord",
                    ),
                ),
            ],
            options={
                "db_table": "country",
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(("code__regex", "^[A-Z]{2}$")),
                        name="country_code_format",
                    ),
                    models.UniqueConstraint(fields=("name_en",), name="country_name_en_key"),
                    models.CheckConstraint(
                        condition=models.Q(("name_en__regex", "\\\\S")),
                        name="country_name_en_not_blank",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("name_es__regex", "\\\\S")),
                        name="country_name_es_not_blank",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("name_pt__regex", "\\\\S")),
                        name="country_name_pt_not_blank",
                    ),
                ],
            },
        ),
        migrations.RunPython(load_countries, migrations.RunPython.noop),
        migrations.CreateModel(
            name="MountainCountryRecord",
            fields=[
                (
                    "pk",
                    models.CompositePrimaryKey(
                        "mountain_id",
                        "country_id",
                        blank=True,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "mountain",
                    models.ForeignKey(
                        db_index=False,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="country_links",
                        to="catalog.mountainrecord",
                    ),
                ),
                (
                    "country",
                    models.ForeignKey(
                        db_column="country_code",
                        db_index=False,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="mountain_links",
                        to="catalog.countryrecord",
                    ),
                ),
            ],
            options={
                "db_table": "mountain_country",
                "indexes": [
                    models.Index(fields=["country", "mountain"], name="mountain_country_reverse")
                ],
            },
        ),
    ]
"""


if __name__ == "__main__":
    sys.exit(main())
