from dataclasses import replace

import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.mountain_update import (
    MountainUpdate,
    mountain_update_violations,
    public_edit_violations,
)
from serendipeak.catalog.new_mountain import NewMountainViolation
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
