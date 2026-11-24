"""Request validation for the prospect analysis (design §10).

Only anonymous figures are accepted: a reference id per customer plus
contract facts. Names are never part of the request.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

MAX_CUSTOMERS = 20_000
MAX_CONTRACTS_PER_CUSTOMER = 50
MAX_CONTRACT_VALUE = 1e11
# Payment percentages a little above 100 happen (penalties, rounding) and are
# clipped; anything beyond this is treated as bad data.
MAX_PAYMENT_PERCENTAGE = 150.0
MAX_TEXT_LENGTH = 200


class ValidationError(ValueError):
    """The request is malformed. The message is safe to return to the caller."""


@dataclass(frozen=True)
class Contract:
    contract_number: str
    project_code: str
    project_name: str
    credit_date: datetime
    contract_value: float
    payment_percentage: float


@dataclass(frozen=True)
class Customer:
    ref: str
    contracts: tuple[Contract, ...]


@dataclass(frozen=True)
class AnalysisRequest:
    as_of: datetime
    customers: tuple[Customer, ...]


def parse_request(payload: Any) -> AnalysisRequest:
    """Validates a decoded JSON payload and returns typed data.

    Raises ValidationError naming the first offending field.
    """
    if not isinstance(payload, dict):
        raise ValidationError("Request body must be a JSON object")

    as_of = _parse_datetime(payload.get("as_of"), "as_of")

    customers_raw = payload.get("customers")
    if not isinstance(customers_raw, list) or not customers_raw:
        raise ValidationError("customers must be a non-empty array")
    if len(customers_raw) > MAX_CUSTOMERS:
        raise ValidationError(f"customers must contain at most {MAX_CUSTOMERS} items")

    seen_refs: set[str] = set()
    customers = []
    for i, raw in enumerate(customers_raw):
        customer = _parse_customer(raw, f"customers[{i}]", as_of)
        if customer.ref in seen_refs:
            raise ValidationError(f"customers[{i}].ref is duplicated")
        seen_refs.add(customer.ref)
        customers.append(customer)

    return AnalysisRequest(as_of=as_of, customers=tuple(customers))


def _parse_customer(raw: Any, path: str, as_of: datetime) -> Customer:
    if not isinstance(raw, dict):
        raise ValidationError(f"{path} must be an object")
    ref = _parse_text(raw.get("ref"), f"{path}.ref", required=True)

    contracts_raw = raw.get("contracts")
    if not isinstance(contracts_raw, list) or not contracts_raw:
        raise ValidationError(f"{path}.contracts must be a non-empty array")
    if len(contracts_raw) > MAX_CONTRACTS_PER_CUSTOMER:
        raise ValidationError(f"{path}.contracts must contain at most {MAX_CONTRACTS_PER_CUSTOMER} items")

    contracts = tuple(_parse_contract(c, f"{path}.contracts[{j}]", as_of) for j, c in enumerate(contracts_raw))
    return Customer(ref=ref, contracts=contracts)


def _parse_contract(raw: Any, path: str, as_of: datetime) -> Contract:
    if not isinstance(raw, dict):
        raise ValidationError(f"{path} must be an object")

    credit_date = _parse_datetime(raw.get("credit_date"), f"{path}.credit_date")
    if credit_date > as_of:
        raise ValidationError(f"{path}.credit_date must not be after as_of")

    contract_value = _parse_number(raw.get("contract_value"), f"{path}.contract_value")
    if not 0 < contract_value < MAX_CONTRACT_VALUE:
        raise ValidationError(f"{path}.contract_value must be greater than 0 and less than {MAX_CONTRACT_VALUE:.0e}")

    payment = _parse_number(raw.get("payment_percentage"), f"{path}.payment_percentage")
    if not 0 <= payment <= MAX_PAYMENT_PERCENTAGE:
        raise ValidationError(f"{path}.payment_percentage must be between 0 and {MAX_PAYMENT_PERCENTAGE:g}")

    project_code = _parse_text(raw.get("project_code"), f"{path}.project_code")
    project_name = _parse_text(raw.get("project_name"), f"{path}.project_name")

    return Contract(
        contract_number=_parse_text(raw.get("contract_number"), f"{path}.contract_number", required=True),
        project_code=project_code,
        project_name=project_name or project_code,
        credit_date=credit_date,
        contract_value=contract_value,
        payment_percentage=min(payment, 100.0),
    )


def _parse_text(value: Any, path: str, required: bool = False) -> str:
    if value is None and not required:
        return ""
    if not isinstance(value, str):
        raise ValidationError(f"{path} must be a string")
    text = value.strip()
    if required and not text:
        raise ValidationError(f"{path} must not be empty")
    if len(text) > MAX_TEXT_LENGTH:
        raise ValidationError(f"{path} must be at most {MAX_TEXT_LENGTH} characters")
    return text


def _parse_number(value: Any, path: str) -> float:
    # bool is a subclass of int; reject it explicitly.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValidationError(f"{path} must be a number")
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):
        raise ValidationError(f"{path} must be a finite number")
    return number


def _parse_datetime(value: Any, path: str) -> datetime:
    if not isinstance(value, str):
        raise ValidationError(f"{path} must be an ISO 8601 date string")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValidationError(f"{path} must be an ISO 8601 date string") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)
