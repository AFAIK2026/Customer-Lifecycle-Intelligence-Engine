import copy

import pytest

from _prospects.schema import ValidationError, parse_request

VALID = {
    "as_of": "2026-11-24T00:00:00.000Z",
    "customers": [
        {
            "ref": "a",
            "contracts": [
                {
                    "contract_number": "C1",
                    "project_code": "TWR",
                    "project_name": "Aspire Tower",
                    "credit_date": "2024-03-01T00:00:00.000Z",
                    "contract_value": 8_000_000,
                    "payment_percentage": 12.5,
                }
            ],
        }
    ],
}


def with_change(path, value):
    payload = copy.deepcopy(VALID)
    target = payload
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    return payload


CONTRACT = ("customers", 0, "contracts", 0)


def test_parses_a_valid_request():
    request = parse_request(VALID)
    contract = request.customers[0].contracts[0]
    assert request.customers[0].ref == "a"
    assert contract.contract_value == 8_000_000
    assert contract.credit_date.year == 2024
    assert request.as_of.tzinfo is not None


def test_clips_payment_slightly_above_100():
    request = parse_request(with_change((*CONTRACT, "payment_percentage"), 120))
    assert request.customers[0].contracts[0].payment_percentage == 100


def test_project_name_falls_back_to_code():
    request = parse_request(with_change((*CONTRACT, "project_name"), None))
    assert request.customers[0].contracts[0].project_name == "TWR"


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ([], "JSON object"),
        (with_change(("as_of",), "yesterday"), "as_of"),
        (with_change(("customers",), []), "customers must be a non-empty array"),
        (with_change(("customers", 0, "ref"), ""), "ref must not be empty"),
        (with_change(("customers", 0, "contracts"), []), "contracts must be a non-empty array"),
        (with_change((*CONTRACT, "contract_value"), 0), "contract_value"),
        (with_change((*CONTRACT, "contract_value"), "8000000"), "contract_value must be a number"),
        (with_change((*CONTRACT, "contract_value"), True), "contract_value must be a number"),
        (with_change((*CONTRACT, "payment_percentage"), 151), "payment_percentage"),
        (with_change((*CONTRACT, "payment_percentage"), -1), "payment_percentage"),
        (with_change((*CONTRACT, "credit_date"), "2027-01-01T00:00:00Z"), "after as_of"),
        (with_change((*CONTRACT, "contract_number"), " "), "contract_number must not be empty"),
    ],
)
def test_rejects_invalid_fields(payload, message):
    with pytest.raises(ValidationError, match=message):
        parse_request(payload)


def test_rejects_duplicate_refs():
    payload = copy.deepcopy(VALID)
    payload["customers"].append(copy.deepcopy(payload["customers"][0]))
    with pytest.raises(ValidationError, match="duplicated"):
        parse_request(payload)


def test_rejects_too_many_contracts():
    contracts = [dict(VALID["customers"][0]["contracts"][0], contract_number=f"C{i}") for i in range(51)]
    with pytest.raises(ValidationError, match="at most 50"):
        parse_request(with_change(("customers", 0, "contracts"), contracts))
