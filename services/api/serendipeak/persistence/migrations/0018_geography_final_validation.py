import django.db.models.deletion
from django.db import migrations, models

ANTARCTICA_CODE = "AQ"

# The country names the v1 catalog stored as text, with the ISO 3166-1 code each stands for.
# Antarctica has none: it is the one link that may exist without a legacy name.
LEGACY_COUNTRY_CODES = {
    "Argentina": "AR",
    "Australia": "AU",
    "Bolivia": "BO",
    "Brazil": "BR",
    "Cameroon": "CM",
    "Canada": "CA",
    "Chile": "CL",
    "Democratic Republic of the Congo": "CD",
    "Ecuador": "EC",
    "Ethiopia": "ET",
    "France": "FR",
    "Georgia": "GE",
    "Greece": "GR",
    "Guyana": "GY",
    "Iceland": "IS",
    "India": "IN",
    "Indonesia": "ID",
    "Iran": "IR",
    "Italy": "IT",
    "Japan": "JP",
    "Kazakhstan": "KZ",
    "Kenya": "KE",
    "Kyrgyzstan": "KG",
    "Lesotho": "LS",
    "Malaysia": "MY",
    "Mexico": "MX",
    "Morocco": "MA",
    "Nepal": "NP",
    "New Zealand": "NZ",
    "North Korea": "KP",
    "Norway": "NO",
    "Pakistan": "PK",
    "Papua New Guinea": "PG",
    "People's Republic of China": "CN",
    "Peru": "PE",
    "Russia": "RU",
    "Slovenia": "SI",
    "South Korea": "KR",
    "Spain": "ES",
    "Sri Lanka": "LK",
    "Sweden": "SE",
    "Switzerland": "CH",
    "Tanzania": "TZ",
    "Turkey": "TR",
    "Uganda": "UG",
    "United Kingdom": "GB",
    "United States": "US",
    "Venezuela": "VE",
}


def _legacy_codes(names):
    return {LEGACY_COUNTRY_CODES.get(name) for name in names}


def validate_geography(apps, schema_editor):
    alias = schema_editor.connection.alias
    mountain = apps.get_model("catalog", "MountainRecord").objects.using(alias)
    link = apps.get_model("catalog", "MountainCountryRecord").objects.using(alias)

    linked = {}
    for mountain_id, country_code in link.values_list("mountain_id", "country_id"):
        linked.setdefault(mountain_id, set()).add(country_code)

    without_continent = []
    disagreeing = []
    for record in mountain.order_by("slug"):
        if record.continent_id is None:
            without_continent.append(record.slug)
        codes = linked.get(record.id, set()) - {ANTARCTICA_CODE}
        if codes != _legacy_codes(record.countries):
            disagreeing.append(record.slug)

    problems = []
    if without_continent:
        problems.append(f"no continent: {', '.join(without_continent)}")
    if disagreeing:
        problems.append(f"countries differ from their links: {', '.join(disagreeing)}")
    if problems:
        raise RuntimeError(
            f"The geography is incomplete ({'; '.join(problems)}). Run apply_geography_backfill "
            "with the private geography input, then migrate again; nothing was migrated."
        )


def restore_legacy_countries(apps, schema_editor):
    alias = schema_editor.connection.alias
    mountain = apps.get_model("catalog", "MountainRecord").objects.using(alias)
    link = apps.get_model("catalog", "MountainCountryRecord").objects.using(alias)
    names = {code: name for name, code in LEGACY_COUNTRY_CODES.items()}

    linked = {}
    for mountain_id, country_code in link.values_list("mountain_id", "country_id"):
        linked.setdefault(mountain_id, set()).add(country_code)

    unnamed = sorted(
        {code for codes in linked.values() for code in codes} - set(names) - {ANTARCTICA_CODE}
    )
    if unnamed:
        raise RuntimeError(
            f"No v1 country name exists for {', '.join(unnamed)}; nothing was migrated back."
        )

    for record in mountain.all():
        legacy = sorted(names[code] for code in linked.get(record.id, set()) if code in names)
        mountain.filter(pk=record.pk).update(countries=legacy)


class Migration(migrations.Migration):
    dependencies = [("catalog", "0017_mountain_continent")]

    # Validates and then enforces what the backfill filled in. On a database without mountains
    # nothing needs filling and the validation passes. Reversing restores the text array from
    # the links, in alphabetical order, and refuses a country that v1 had no name for; the
    # continent returns to nullable and the links stay.
    operations = [
        migrations.RunPython(validate_geography, restore_legacy_countries),
        migrations.AlterField(
            model_name="mountainrecord",
            name="continent",
            field=models.ForeignKey(
                db_column="continent_code",
                on_delete=django.db.models.deletion.PROTECT,
                related_name="mountains",
                to="catalog.continentrecord",
            ),
        ),
        migrations.RemoveField(model_name="mountainrecord", name="countries"),
    ]
