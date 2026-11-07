import ast
import json

import pytest

from tools import generate_geography_reference as generator


def write(path, document):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")


@pytest.fixture
def inputs(tmp_path, monkeypatch):
    """A synthetic copy of the data files the generator reads, with seven countries."""
    names = {
        "002": ["Africa", "África", "África"],
        "AQ": ["Antarctica", "Antártida", "Antártida"],
        "142": ["Asia", "Asia", "Ásia"],
        "150": ["Europe", "Europa", "Europa"],
        "003": ["North America", "América del Norte", "América do Norte"],
        "009": ["Oceania", "Oceanía", "Oceania"],
        "005": ["South America", "Sudamérica", "América do Sul"],
        "XA": ["Alphaland", "Alfalandia", "Alfalândia"],
        "XB": ["Betaland", "Betalandia", "Betalândia"],
        "XC": ["Gammaland", "Gamalandia", "Gamalândia"],
        "XD": ["Deltaland", "Deltalandia", "Deltalândia"],
        "XE": ["Epsilonia", "Épsilonia", "Épsilonia"],
        "XF": ["Zetaland", "Zetalandia", "Zetalândia"],
    }
    root = tmp_path / "inputs"
    write(root / "core" / "package.json", {"name": "cldr-core", "version": "49.0.0"})
    write(
        root / "core" / "supplemental" / "territoryContainment.json",
        {
            "supplemental": {
                "territoryContainment": {
                    "002": {"_contains": ["XA"]},
                    "142": {"_contains": ["034"]},
                    "034": {"_contains": ["XB"]},
                    "150": {"_contains": ["XC"]},
                    "021": {"_contains": ["XD"]},
                    "013": {"_contains": []},
                    "029": {"_contains": []},
                    "005": {"_contains": ["XE"]},
                    "009": {"_contains": ["XF", "QO"]},
                    "QO": {"_contains": ["AQ"]},
                }
            }
        },
    )
    write(root / "names" / "package.json", {"name": "cldr-localenames-full", "version": "49.0.0"})
    for index, locale in enumerate(generator.LOCALES):
        write(
            root / "names" / "main" / locale / "territories.json",
            {
                "main": {
                    locale: {
                        "localeDisplayNames": {
                            "territories": {code: value[index] for code, value in names.items()}
                            | {"XA-alt-short": "ignored"}
                        }
                    }
                }
            },
        )
    iso = root / "iso.json"
    write(
        iso,
        {"3166-1": [{"alpha_2": code} for code in ("XF", "AQ", "XA", "XB", "XC", "XD", "XE")]},
    )
    import hashlib

    monkeypatch.setattr(generator, "ISO_CODES_SHA256", hashlib.sha256(iso.read_bytes()).hexdigest())
    monkeypatch.setattr(generator, "EXPECTED_COUNTRIES", 7)

    return {
        "cldr_core": root / "core",
        "cldr_names": root / "names",
        "iso_codes": iso,
        "retrieved_on": "2026-11-07",
    }


def rows_of(source, name):
    tree = ast.parse(source)
    for node in tree.body:
        if isinstance(node, ast.Assign) and node.targets[0].id == name:
            return ast.literal_eval(node.value)
    raise AssertionError(name)


def test_it_generates_the_two_migrations_with_every_row(inputs):
    files = generator.generate(**inputs)

    assert set(files) == {generator.CONTINENT_MIGRATION, generator.COUNTRY_MIGRATION}
    assert rows_of(files[generator.CONTINENT_MIGRATION], "CONTINENTS") == (
        ("AF", "Africa", "África", "África"),
        ("AN", "Antarctica", "Antártida", "Antártida"),
        ("AS", "Asia", "Asia", "Ásia"),
        ("EU", "Europe", "Europa", "Europa"),
        ("NA", "North America", "América del Norte", "América do Norte"),
        ("OC", "Oceania", "Oceanía", "Oceania"),
        ("SA", "South America", "Sudamérica", "América do Sul"),
    )
    countries = rows_of(files[generator.COUNTRY_MIGRATION], "COUNTRIES")
    assert [(row[0], row[1], row[4]) for row in countries] == [
        ("AQ", "Antarctica", "AN"),
        ("XA", "Alphaland", "AF"),
        ("XB", "Betaland", "AS"),
        ("XC", "Gammaland", "EU"),
        ("XD", "Deltaland", "NA"),
        ("XE", "Epsilonia", "SA"),
        ("XF", "Zetaland", "OC"),
    ]


def test_the_standard_form_of_a_name_is_used_never_an_alternative(inputs):
    countries = rows_of(generator.generate(**inputs)[generator.COUNTRY_MIGRATION], "COUNTRIES")

    assert "ignored" not in {name for row in countries for name in row}


def test_the_same_inputs_give_the_same_bytes(inputs):
    assert generator.generate(**inputs) == generator.generate(**inputs)


def test_both_files_are_valid_python_and_record_their_provenance(inputs):
    for name, source in generator.generate(**inputs).items():
        compile(source, name, "exec")
        assert "Unicode CLDR 49.0.0" in source
        assert "Debian iso-codes 4.20.1" in source
        assert "Inputs downloaded on 2026-11-07." in source
        assert "Name overrides: none. Every name is the CLDR value." in source
        assert "tools/generate_geography_reference.py" in source


def test_the_generated_file_has_no_line_over_the_formatter_limit(inputs):
    for source in generator.generate(**inputs).values():
        assert max(len(line) for line in source.splitlines()) <= 100


def test_an_override_changes_exactly_the_name_it_names_and_is_listed(inputs, monkeypatch):
    monkeypatch.setattr(
        generator,
        "NAME_OVERRIDES",
        (("XC", "en", "Gammaland", "Gamma", "the owner prefers the short form"),),
    )

    source = generator.generate(**inputs)[generator.COUNTRY_MIGRATION]

    assert ("XC", "Gamma", "Gamalandia", "Gamalândia", "EU") in rows_of(source, "COUNTRIES")
    assert "the owner prefers the short form" in source
    assert "none. Every name" not in source


def test_an_override_of_a_value_cldr_does_not_hold_is_refused(inputs, monkeypatch):
    monkeypatch.setattr(
        generator, "NAME_OVERRIDES", (("XC", "en", "Not CLDR's", "Gamma", "a mistake"),)
    )

    with pytest.raises(generator.ReferenceDataError, match="another CLDR value"):
        generator.generate(**inputs)


@pytest.mark.parametrize("package", ["cldr_core", "cldr_names"])
def test_a_package_of_another_version_is_refused(inputs, package):
    write(inputs[package] / "package.json", {"name": "x", "version": "48.2.0"})

    with pytest.raises(generator.ReferenceDataError, match="49.0.0"):
        generator.generate(**inputs)


def test_a_list_of_codes_that_is_not_the_pinned_release_is_refused(inputs):
    inputs["iso_codes"].write_text('{"3166-1": []}', encoding="utf-8")

    with pytest.raises(generator.ReferenceDataError, match="iso-codes"):
        generator.generate(**inputs)


def test_a_country_count_other_than_the_expected_stops_the_run(inputs, monkeypatch):
    monkeypatch.setattr(generator, "EXPECTED_COUNTRIES", 249)

    with pytest.raises(generator.ReferenceDataError, match="expected 249"):
        generator.generate(**inputs)


def test_a_country_cldr_does_not_name_stops_the_run(inputs):
    path = inputs["cldr_names"] / "main" / "pt" / "territories.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    del document["main"]["pt"]["localeDisplayNames"]["territories"]["XB"]
    write(path, document)

    with pytest.raises(generator.ReferenceDataError, match="no pt name for XB"):
        generator.generate(**inputs)


def test_a_country_outside_every_continent_stops_the_run(inputs):
    path = inputs["cldr_core"] / "supplemental" / "territoryContainment.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    del document["supplemental"]["territoryContainment"]["150"]
    write(path, document)

    with pytest.raises(generator.ReferenceDataError, match=r"missing \['XC'\]"):
        generator.generate(**inputs)


def test_a_country_in_two_continents_stops_the_run(inputs):
    path = inputs["cldr_core"] / "supplemental" / "territoryContainment.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    document["supplemental"]["territoryContainment"]["150"]["_contains"].append("XA")
    write(path, document)

    with pytest.raises(generator.ReferenceDataError, match=r"ambiguous \['XA'\]"):
        generator.generate(**inputs)


def test_duplicate_english_names_stop_the_run(inputs):
    path = inputs["cldr_names"] / "main" / "en" / "territories.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    document["main"]["en"]["localeDisplayNames"]["territories"]["XB"] = "Alphaland"
    write(path, document)

    with pytest.raises(generator.ReferenceDataError, match="not unique"):
        generator.generate(**inputs)


def test_an_untrimmed_name_stops_the_run(inputs):
    path = inputs["cldr_names"] / "main" / "es" / "territories.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    document["main"]["es"]["localeDisplayNames"]["territories"]["XB"] = " Betalandia"
    write(path, document)

    with pytest.raises(generator.ReferenceDataError, match="blank or untrimmed"):
        generator.generate(**inputs)


def test_the_command_writes_the_files_and_reports_failures_with_an_exit_code(
    inputs, tmp_path, capsys
):
    out = tmp_path / "out"
    out.mkdir()
    arguments = [
        "--cldr-core", str(inputs["cldr_core"]),
        "--cldr-names", str(inputs["cldr_names"]),
        "--iso-codes", str(inputs["iso_codes"]),
        "--retrieved-on", "2026-11-07",
        "--output-dir", str(out),
    ]  # fmt: skip

    assert generator.main(arguments) == 0
    assert sorted(path.name for path in out.iterdir()) == sorted(
        [generator.CONTINENT_MIGRATION, generator.COUNTRY_MIGRATION]
    )

    write(inputs["cldr_core"] / "package.json", {"name": "cldr-core", "version": "1.0.0"})
    assert generator.main(arguments) == 1
    assert "error:" in capsys.readouterr().err
