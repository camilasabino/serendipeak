from dataclasses import replace

import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.mountain_update import (
    MountainUpdate,
    mountain_update_violations,
    public_edit_violations,
)
from serendipeak.catalog.new_mountain import (
    NewMountainViolation,
    NewPhotograph,
    PhotographCredit,
)
from serendipeak.catalog.publication import PublicationViolation
from tests.support.catalog import mountain

VALID = MountainUpdate(slug="new-peak", name="New Peak", elevation_meters=3123, continent_code="SA")


def test_a_complete_update_has_no_violation():
    full = replace(
        VALID,
        summary="A fine mountain.",
        osm_node_id=1,
        wikidata_id="Q39739",
        country_codes=("AR",),
    )

    assert mountain_update_violations(full) == ()
    assert mountain_update_violations(VALID) == ()


@pytest.mark.parametrize(
    ("overrides", "violation"),
    [
        ({"slug": "Not A Slug"}, NewMountainViolation.SLUG_INVALID),
        ({"slug": "today"}, NewMountainViolation.SLUG_INVALID),
        ({"name": "  "}, NewMountainViolation.NAME_BLANK),
        ({"elevation_meters": 0}, NewMountainViolation.ELEVATION_NOT_POSITIVE),
        ({"summary": "no capital or period"}, NewMountainViolation.SUMMARY_INVALID),
        ({"summary": ""}, NewMountainViolation.SUMMARY_INVALID),
        ({"osm_node_id": 0}, NewMountainViolation.OSM_NODE_ID_NOT_POSITIVE),
        ({"wikidata_id": "39739"}, NewMountainViolation.WIKIDATA_ID_INVALID),
    ],
)
def test_each_rule_of_the_content_is_judged(overrides, violation):
    assert mountain_update_violations(replace(VALID, **overrides)) == (violation,)


def with_photograph(**credit):
    credit.setdefault("author", "A. Photographer")

    return replace(VALID, photograph=NewPhotograph(data=b"file", **credit))


def test_an_update_without_a_photograph_judges_no_credit():
    assert mountain_update_violations(VALID) == ()


def test_a_complete_credit_has_no_violation():
    complete = with_photograph(
        license_name="CC BY 4.0",
        license_url="https://creativecommons.org/licenses/by/4.0",
        source_page_url="https://example.org/photo",
    )

    assert mountain_update_violations(complete) == ()


@pytest.mark.parametrize(
    ("credit", "violation"),
    [
        ({"author": " "}, NewMountainViolation.IMAGE_AUTHOR_MISSING),
        ({"license_name": " "}, NewMountainViolation.IMAGE_LICENSE_NAME_BLANK),
        (
            {"license_url": "https://example.org/license"},
            NewMountainViolation.IMAGE_LICENSE_URL_WITHOUT_LICENSE,
        ),
        (
            {"license_name": "CC", "license_url": "http://example.org/license"},
            NewMountainViolation.IMAGE_LICENSE_URL_NOT_PUBLIC_LINK,
        ),
        (
            {"source_page_url": "javascript:alert(1)"},
            NewMountainViolation.IMAGE_SOURCE_PAGE_URL_NOT_PUBLIC_LINK,
        ),
    ],
)
def test_each_rule_of_the_credit_is_judged(credit, violation):
    assert mountain_update_violations(with_photograph(**credit)) == (violation,)


def test_content_violations_precede_credit_violations():
    broken = replace(with_photograph(author=""), name=" ")

    assert mountain_update_violations(broken) == (
        NewMountainViolation.NAME_BLANK,
        NewMountainViolation.IMAGE_AUTHOR_MISSING,
    )


def test_every_violation_is_reported_at_once():
    broken = replace(VALID, slug="Bad", name="", elevation_meters=-1, wikidata_id="x")

    assert set(mountain_update_violations(broken)) == {
        NewMountainViolation.SLUG_INVALID,
        NewMountainViolation.NAME_BLANK,
        NewMountainViolation.ELEVATION_NOT_POSITIVE,
        NewMountainViolation.WIKIDATA_ID_INVALID,
    }


def test_a_draft_may_be_saved_incomplete():
    draft = mountain(status=MountainStatus.DRAFT, camera=None, primary_image=None, summary="x")

    assert public_edit_violations(draft) == ()


def test_an_active_mountain_must_stay_publishable():
    assert public_edit_violations(mountain()) == ()
    assert public_edit_violations(mountain(summary="not a sentence")) == (
        PublicationViolation.SUMMARY_INVALID,
    )


def test_an_inactive_mountain_may_lack_its_camera_but_nothing_else():
    inactive = mountain(status=MountainStatus.INACTIVE, camera=None)

    assert public_edit_violations(inactive) == ()
    assert public_edit_violations(replace(inactive, elevation_meters=0)) == (
        PublicationViolation.ELEVATION_NOT_POSITIVE,
    )


def test_an_active_mountain_without_a_camera_is_not_allowed():
    assert public_edit_violations(mountain(camera=None)) == (PublicationViolation.CAMERA_MISSING,)


def test_a_credit_alone_is_judged_by_the_credit_rules():
    with_credit = replace(
        VALID, credit=PhotographCredit(author=" ", source_page_url="http://x.org")
    )

    assert mountain_update_violations(with_credit) == (
        NewMountainViolation.IMAGE_AUTHOR_MISSING,
        NewMountainViolation.IMAGE_SOURCE_PAGE_URL_NOT_PUBLIC_LINK,
    )


def test_a_complete_credit_alone_has_no_violation():
    credit = PhotographCredit(
        author="A. Photographer",
        license_name="CC BY 4.0",
        license_url="https://creativecommons.org/licenses/by/4.0/",
    )

    assert mountain_update_violations(replace(VALID, credit=credit)) == ()


def test_a_photograph_and_a_credit_cannot_be_given_together():
    with pytest.raises(ValueError, match="not several"):
        replace(
            with_photograph(),
            credit=PhotographCredit(author="Someone else"),
        )


def test_removing_the_photograph_excludes_replacing_or_re_crediting_it():
    removal = replace(VALID, remove_photograph=True)

    assert mountain_update_violations(removal) == ()
    with pytest.raises(ValueError, match="not several"):
        replace(removal, photograph=NewPhotograph(data=b"file", author="A. Photographer"))
    with pytest.raises(ValueError, match="not several"):
        replace(removal, credit=PhotographCredit(author="Someone else"))


def test_leaving_the_photograph_alone_is_not_removing_it():
    assert VALID.remove_photograph is False
