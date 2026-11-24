from datetime import datetime, timezone

import pytest
from conftest import synthetic_payload

import prospect_analysis as cli

HEADER = "Customer Name\tContract Number\tProject\tProject(Desc)\tCredit Date\tTCP\tPayment Percentage"


def write(tmp_path, name, lines):
    path = tmp_path / name
    path.write_text("\n".join([HEADER, *lines]), encoding="utf-8")
    return path


def test_reads_tab_report_and_groups_customers_by_name(tmp_path):
    path = write(
        tmp_path,
        "r.tsv",
        [
            "DELA CRUZ, JUAN\tC1\tTWR\tAspire Tower\t03/01/2024 12:00:00 am\t8000000\t12.5",
            "dela cruz, juan\tC2\tRES\tBayview Residences\t05/01/2025 12:00:00 am\t6,000,000\t3",
            "SANTOS, MARIA\tC3\tTWR\tAspire Tower\t01/15/2023 12:00:00 am\t5000000\t40",
        ],
    )
    customers, names = cli.read_reports([path])
    assert set(customers) == {"dela cruz, juan", "santos, maria"}
    assert names["dela cruz, juan"] == "DELA CRUZ, JUAN"
    assert customers["dela cruz, juan"]["C2"]["contract_value"] == 6_000_000


def test_later_files_update_the_same_contract(tmp_path):
    old = write(tmp_path, "old.tsv", ["A\tC1\tTWR\tAspire Tower\t03/01/2024 12:00:00 am\t8000000\t5"])
    new = write(tmp_path, "new.tsv", ["A\tC1\tTWR\tAspire Tower\t03/01/2024 12:00:00 am\t8000000\t11"])
    customers, _ = cli.read_reports([old, new])
    assert customers["a"]["C1"]["payment_percentage"] == 11


def test_payload_contains_no_names(tmp_path):
    path = write(tmp_path, "r.tsv", ["SECRET NAME\tC1\tTWR\tAspire Tower\t03/01/2024 12:00:00 am\t8000000\t5"])
    customers, _ = cli.read_reports([path])
    payload, ref_to_key = cli.build_payload(customers, datetime(2026, 11, 24, tzinfo=timezone.utc))
    assert "SECRET" not in str(payload).upper()
    assert ref_to_key == {"C00001": "secret name"}


def test_reports_missing_columns(tmp_path):
    path = tmp_path / "bad.tsv"
    path.write_text("Customer Name\tTCP\nA\t1", encoding="utf-8")
    with pytest.raises(cli.ReportError, match="missing column"):
        cli.read_reports([path])


def test_reports_bad_dates(tmp_path):
    path = write(tmp_path, "r.tsv", ["A\tC1\tTWR\tAspire Tower\t2024-03-01\t8000000\t5"])
    with pytest.raises(cli.ReportError, match="Credit Date"):
        cli.read_reports([path])


def test_end_to_end_on_a_generated_report(tmp_path, capsys):
    payload = synthetic_payload(n=1500, seed=4)
    lines = []
    for customer in payload["customers"]:
        for c in customer["contracts"]:
            date = datetime.fromisoformat(c["credit_date"]).strftime("%m/%d/%Y 12:00:00 am")
            lines.append(
                f"NAME {customer['ref']}\t{c['contract_number']}\t{c['project_code']}\t{c['project_name']}\t"
                f"{date}\t{c['contract_value']:.0f}\t{c['payment_percentage']}"
            )
    path = write(tmp_path, "big.tsv", lines)

    assert cli.main([str(path), "--as-of", "2026-11-24"]) == 0
    out = capsys.readouterr().out
    assert "Status:            ok" in out
    assert "Bayview Residences" in out
    assert "NAME R" not in out  # names hidden by default

    assert cli.main([str(path), "--as-of", "2026-11-24", "--show-names", "--top", "3"]) == 0
    assert "NAME R" in capsys.readouterr().out


def test_reads_windows_1252_exports(tmp_path):
    path = tmp_path / "r.xls"
    text = "\n".join([HEADER, "PE\u00d1A, JOSE\tC1\tTWR\tAspire Tower\t03/01/2024 12:00:00 am\t8000000\t5"])
    path.write_bytes(text.encode("cp1252"))
    customers, names = cli.read_reports([path])
    assert names == {"pe\u00f1a, jose": "PE\u00d1A, JOSE"}
