#!/usr/bin/env python3
"""Run the prospect analysis on Sales Report exports (Stage 1, amendment A3).

Reads the same Sales Report format the app imports (tab- or comma-separated,
columns: Customer Name, Contract Number, Project, Project(Desc), Credit Date,
TCP, Payment Percentage) and prints the model's accuracy, the factors that
predict repeat buying, and the top prospects.

Everything runs locally; nothing is sent anywhere. Customer names are hidden
unless --show-names is passed.

Usage:
    python scripts/prospect_analysis.py report.tsv [more_reports.tsv ...]
    python scripts/prospect_analysis.py report.tsv --as-of 2026-11-24 --json
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))

from _prospects import ValidationError, analyse, parse_request  # noqa: E402

REQUIRED_COLUMNS = (
    "Customer Name",
    "Contract Number",
    "Project",
    "Project(Desc)",
    "Credit Date",
    "TCP",
    "Payment Percentage",
)
CREDIT_DATE_FORMATS = ("%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y")


class ReportError(ValueError):
    pass


def read_reports(paths: list[Path]) -> tuple[dict[str, dict[str, dict]], dict[str, str]]:
    """Returns contracts grouped by customer, and each customer's display name.

    Customers are matched by name, case-insensitively (same rule as the app).
    When the same contract appears in several files, the later file wins, so
    pass reports oldest first.
    """
    customers: dict[str, dict[str, dict]] = {}
    names: dict[str, str] = {}
    for path in paths:
        text = read_text(path)
        lines = text.splitlines()
        if len(lines) < 2:
            raise ReportError(f"{path}: needs a header row and at least one data row")
        delimiter = "\t" if "\t" in lines[0] else ","
        reader = csv.DictReader(lines, delimiter=delimiter)
        header = [h.strip() for h in reader.fieldnames or []]
        missing = [c for c in REQUIRED_COLUMNS if c not in header]
        if missing:
            raise ReportError(f"{path}: missing column(s): {', '.join(missing)}")
        reader.fieldnames = header

        for line_number, raw in enumerate(reader, start=2):
            if not any((v or "").strip() for v in raw.values()):
                continue
            row = {k: (v or "").strip() for k, v in raw.items() if k}
            name = row["Customer Name"]
            contract_number = row["Contract Number"]
            if not name or not contract_number:
                raise ReportError(f"{path} line {line_number}: Customer Name and Contract Number are required")
            try:
                contract = {
                    "contract_number": contract_number,
                    "project_code": row["Project"],
                    "project_name": row["Project(Desc)"],
                    "credit_date": parse_credit_date(row["Credit Date"]).isoformat(),
                    "contract_value": float(row["TCP"].replace(",", "")),
                    "payment_percentage": float(row["Payment Percentage"].replace(",", "").rstrip("%")),
                }
            except ValueError as exc:
                raise ReportError(f"{path} line {line_number}: {exc}") from exc

            key = name.lower()
            names.setdefault(key, name)
            customers.setdefault(key, {})[contract_number] = contract
    return customers, names


def read_text(path: Path) -> str:
    """UTF-8 when valid, otherwise Windows-1252, which is what the source system exports
    (and what the web app decodes), e.g. "Ñ" in PEÑA is byte 0xD1."""
    raw = path.read_bytes()
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace")


def parse_credit_date(raw: str) -> datetime:
    for fmt in CREDIT_DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    raise ValueError(f'Credit Date "{raw}" is not in MM/DD/YYYY 12:00:00 am format')


def build_payload(customers: dict[str, dict[str, dict]], as_of: datetime) -> tuple[dict, dict[str, str]]:
    """Anonymised request body plus a ref → customer key map for local display."""
    payload_customers = []
    ref_to_key = {}
    for index, key in enumerate(sorted(customers), start=1):
        ref = f"C{index:05d}"
        ref_to_key[ref] = key
        payload_customers.append({"ref": ref, "contracts": list(customers[key].values())})
    return {"as_of": as_of.isoformat(), "customers": payload_customers}, ref_to_key


def print_report(result: dict, labels: dict[str, str], top: int) -> None:
    model = result["model"]
    trained = model["trained_on"]
    print(f"Status:            {result['status']}")
    print(f"Method:            {model['method']}")
    print(f"Trained on:        {trained['repeat']} repeat + {trained['single']} single-contract customers")
    print(f"Excluded (recent): {model['excluded_recent']} customers whose first purchase is under 6 months old")
    if model["base_rate"] is not None:
        print(f"Base rate:         {model['base_rate'] * 100:.1f}% of customers bought again")
    if model["cv_auc"] is not None:
        print(f"Accuracy (CV AUC): {model['cv_auc']:.3f}   (0.5 = coin flip, 1.0 = perfect, needs >= 0.60)")
    if model["reference_project"]:
        print(f"Reference project: {model['reference_project']}")

    if result["status"] == "insufficient_data":
        print("\nNot enough data: needs at least 30 repeat and 30 single-contract customers in training.")
        return
    if result["status"] == "weak_signal":
        print("\nThe purchase data does not predict repeat buying reliably yet. Stage 2 should not proceed.")
        return

    print("\nWhat predicts a repeat buyer (95% confidence, statistically supported only):")
    if not result["drivers"]:
        print("  (no individual factor is statistically supported)")
    for driver in result["drivers"]:
        print(f"  • {driver['statement']}")

    summary = result["summary"]
    print(f"\nScored {summary['scored']} single-contract customers: "
          f"{summary['high']} high-potential, {summary['promising']} promising")
    print(f"\nTop {min(top, len(result['prospects']))} prospects:")
    for prospect in result["prospects"][:top]:
        reasons = ", ".join(prospect["reasons"]) or "-"
        print(f"  {labels[prospect['ref']]:<32} {prospect['probability'] * 100:5.1f}%  "
              f"{prospect['lift']:4.1f}x  {prospect['tier']:<9}  {reasons}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("reports", nargs="+", type=Path, help="Sales Report files, oldest first")
    parser.add_argument("--as-of", help="Analysis date (YYYY-MM-DD). Defaults to today.")
    parser.add_argument("--top", type=int, default=10, help="How many prospects to list (default 10)")
    parser.add_argument("--show-names", action="store_true", help="Show real customer names instead of refs")
    parser.add_argument("--json", action="store_true", help="Print the raw analysis result as JSON")
    args = parser.parse_args(argv)

    as_of = (
        datetime.fromisoformat(args.as_of).replace(tzinfo=timezone.utc)
        if args.as_of
        else datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    )

    try:
        customers, names = read_reports(args.reports)
        payload, ref_to_key = build_payload(customers, as_of)
        result = analyse(parse_request(payload))
    except (ReportError, ValidationError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0

    labels = {ref: (names[key] if args.show_names else ref) for ref, key in ref_to_key.items()}
    print_report(result, labels, args.top)
    return 0


if __name__ == "__main__":
    sys.exit(main())
