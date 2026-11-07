# Reference data: generated, immutable once applied. Do not edit by hand.
#
# Names: Unicode CLDR 49.0.0, locales en, es, pt, territory
# display names in their standard form, from the npm packages
# cldr-core@49.0.0
#   sha512-2Z2dYeDO95AbKIG9dIUdZy6DD4f0hhHjTYnaHZj/9JTQ82pX5EsJlCs2BXPWi4vd1d98MwotOivh4Uthxwri4A==
# cldr-localenames-full@49.0.0
#   sha512-nTBCysDVK+JHb2hPhb26fJGp9+Lw0mOiqVsJ/9aTEQIduBTnghTSLgZitsM7FLa1Vjr0K0hfBQMdBgoyDxK0nQ==
# Country codes: the 249 officially assigned ISO 3166-1 alpha-2 codes, as listed by
# Debian iso-codes 4.20.1, data/iso_3166-1.json
#   sha256 f01b812b57fba9f31ff621bf33e7c7570a01964dbeb5be2167e94decf538c89f
#   https://salsa.debian.org/iso-codes-team/iso-codes/-/raw/v4.20.1/data/iso_3166-1.json
# Reference continent of a country: its UN M49 region in CLDR's territoryContainment,
# with the Americas split into South America and the rest, and AQ set to AN.
# Name overrides: none. Every name is the CLDR value.
# Inputs downloaded on 2026-11-07.
# Generator:
#   uv run python tools/generate_geography_reference.py
#   --cldr-core <cldr-core 49.0.0>
#   --cldr-names <cldr-localenames-full 49.0.0>
#   --iso-codes <iso_3166-1.json>
#   --retrieved-on 2026-11-07
#   --output-dir serendipeak/persistence/migrations

from django.db import migrations, models

CONTINENTS = (
    ("AF", "Africa", "África", "África"),
    ("AN", "Antarctica", "Antártida", "Antártida"),
    ("AS", "Asia", "Asia", "Ásia"),
    ("EU", "Europe", "Europa", "Europa"),
    ("NA", "North America", "América del Norte", "América do Norte"),
    ("OC", "Oceania", "Oceanía", "Oceania"),
    ("SA", "South America", "Sudamérica", "América do Sul"),
)


def load_continents(apps, schema_editor):
    continent = apps.get_model("catalog", "ContinentRecord")
    continent.objects.using(schema_editor.connection.alias).bulk_create(
        continent(code=code, name_en=name_en, name_es=name_es, name_pt=name_pt)
        for code, name_en, name_es, name_pt in CONTINENTS
    )


class Migration(migrations.Migration):
    dependencies = [("catalog", "0014_localized_mountain_text")]

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
                        condition=models.Q(("name_en__regex", "\\S")),
                        name="continent_name_en_not_blank",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("name_es__regex", "\\S")),
                        name="continent_name_es_not_blank",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("name_pt__regex", "\\S")),
                        name="continent_name_pt_not_blank",
                    ),
                ],
            },
        ),
        migrations.RunPython(load_continents, migrations.RunPython.noop),
    ]
