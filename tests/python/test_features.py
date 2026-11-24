from _prospects.features import (
    OTHER_PROJECT,
    TENURE_YEARS,
    FeatureEncoder,
    build_rows,
    first_contract,
)
from _prospects.schema import parse_request


def contract(number, date, code="TWR", value=5e6, pct=5.0):
    return {
        "contract_number": number,
        "project_code": code,
        "project_name": f"Project {code}",
        "credit_date": date,
        "contract_value": value,
        "payment_percentage": pct,
    }


def request(customers, as_of="2026-11-24T00:00:00Z"):
    return parse_request({"as_of": as_of, "customers": customers})


def test_first_contract_is_earliest_with_contract_number_tie_break():
    req = request(
        [
            {
                "ref": "a",
                "contracts": [
                    contract("C3", "2024-05-01T00:00:00Z"),
                    contract("C2", "2023-01-01T00:00:00Z", value=9e6),
                    contract("C1", "2023-01-01T00:00:00Z", value=7e6),
                ],
            }
        ]
    )
    assert first_contract(req.customers[0]).contract_number == "C1"


def test_rows_flag_repeat_buyers_and_recent_customers():
    req = request(
        [
            {"ref": "old-repeat", "contracts": [contract("A", "2022-01-01T00:00:00Z"), contract("B", "2026-10-01T00:00:00Z")]},
            {"ref": "recent", "contracts": [contract("C", "2026-07-01T00:00:00Z")]},
            {"ref": "just-in", "contracts": [contract("D", "2026-05-26T00:00:00Z")]},
        ]
    )
    rows = {r.ref: r for r in build_rows(req)}
    assert rows["old-repeat"].is_repeat and rows["old-repeat"].in_training
    # Features come from the first contract even though a newer one exists.
    assert rows["old-repeat"].first_contract.contract_number == "A"
    assert not rows["recent"].in_training
    assert rows["just-in"].in_training  # exactly 182 days
    assert abs(rows["old-repeat"].tenure_years - 4.9) < 0.05


def test_small_projects_are_grouped_and_most_common_is_reference():
    customers = []
    for i, (code, count) in enumerate([("BIG", 30), ("MID", 20), ("TINY", 3), ("WEE", 2)]):
        customers += [{"ref": f"{code}{k}", "contracts": [contract(f"{code}{k}", "2023-01-01T00:00:00Z", code)]} for k in range(count)]
    rows = build_rows(request(customers))
    encoder = FeatureEncoder.fit(rows)

    assert encoder.reference_project == "BIG"
    assert encoder.project_columns == ("MID", OTHER_PROJECT)
    assert encoder.group_of("TINY") == OTHER_PROJECT
    assert encoder.group_of("NEVER_SEEN") == OTHER_PROJECT
    assert encoder.label_of("MID") == "Project MID"

    matrix = encoder.transform(rows)
    names = encoder.feature_names
    tiny_row = next(i for i, r in enumerate(rows) if r.project_key == "TINY")
    assert matrix[tiny_row, names.index("project_OTHER")] == 1
    assert matrix[tiny_row, names.index("project_MID")] == 0


def test_fixed_tenure_overrides_every_row():
    rows = build_rows(
        request(
            [
                {"ref": "a", "contracts": [contract("A", "2020-01-01T00:00:00Z")]},
                {"ref": "b", "contracts": [contract("B", "2025-01-01T00:00:00Z")]},
            ]
        )
    )
    encoder = FeatureEncoder.fit(rows)
    column = encoder.feature_names.index(TENURE_YEARS)
    assert list(encoder.transform(rows, fixed_tenure=2.5)[:, column]) == [2.5, 2.5]


def test_reached_10_and_log_value():
    rows = build_rows(request([{"ref": "a", "contracts": [contract("A", "2023-01-01T00:00:00Z", value=1e6, pct=10)]}]))
    matrix = FeatureEncoder.fit(rows).transform(rows)
    assert matrix[0, 2] == 1.0
    assert abs(matrix[0, 0] - 13.8155) < 1e-3
