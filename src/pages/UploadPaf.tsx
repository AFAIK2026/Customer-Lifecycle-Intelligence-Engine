import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, CheckCircle2, AlertCircle, AlertTriangle, ShieldCheck } from "lucide-react";
import { useAppData, type ImportPafResult } from "@/context/AppDataContext";
import { readWorkbook } from "@/lib/pafExcel";
import { PAF_SHEETS, type PafRowIssue } from "@/lib/paf";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { DropZone } from "@/components/upload/DropZone";
import { ImportHistory } from "@/components/upload/ImportHistory";

interface FileError {
  fileName: string;
  message: string;
}

export function UploadPaf() {
  const { data, importPafWorkbook, removePafImport } = useAppData();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FileError[]>([]);
  const [results, setResults] = useState<ImportPafResult[]>([]);

  // Files are imported one after another, in the order given, so later files update earlier ones.
  const handleFiles = useCallback(
    async (files: File[]) => {
      setBusy(true);
      const nextErrors: FileError[] = [];
      const nextResults: ImportPafResult[] = [];
      for (const file of files) {
        try {
          const sheets = await readWorkbook(file);
          nextResults.push(importPafWorkbook(file.name, sheets));
        } catch (e) {
          nextErrors.push({ fileName: file.name, message: e instanceof Error ? e.message : "Failed to process file" });
        }
      }
      setErrors(nextErrors);
      setResults(nextResults);
      setBusy(false);
    },
    [importPafWorkbook]
  );

  function handleRemove(importId: string, fileName: string) {
    const confirmed = window.confirm(
      `Remove "${fileName}"?\n\nClient details will be rebuilt from the remaining PAF files. Payment data is not affected.`
    );
    if (!confirmed) return;
    removePafImport(importId);
    setResults([]);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Upload Purchase Application Forms</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload the PAF workbook to add client details such as birthdate, contact and employment information.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/[0.06] px-4 py-3 text-xs text-muted-foreground">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-success" aria-hidden />
        <p>
          TIN and government ID numbers are never imported; only the ID type is kept. Details stay in this browser and
          are hidden on screen while "Customer names hidden" is on.
        </p>
      </div>

      <DropZone
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        title={busy ? "Reading workbook…" : "Drag & drop PAF workbooks (.xlsx) here, or click to browse"}
        hint={`Expects a "${PAF_SHEETS.customer}" sheet; "${PAF_SHEETS.spouse}" and "${PAF_SHEETS.corporate}" are optional`}
        onFiles={handleFiles}
        busy={busy}
      />

      {errors.map((err, i) => (
        <Card key={`${i}-${err.fileName}`} className="border-destructive/40">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle size={18} className="text-destructive shrink-0" />
            <p className="text-sm text-destructive">
              <span className="font-medium">{err.fileName}:</span> {err.message}
            </p>
          </CardContent>
        </Card>
      ))}

      {results.map((result, i) => (
        <PafResultCard key={`${i}-${result.fileName}`} result={result} />
      ))}

      <ImportHistory
        title="Imported PAF Files"
        columns={["Rows", "Matched at import", "Not yet in Sales Report"]}
        rows={[...data.paf_imports].reverse().map((record) => ({
          id: record.id,
          fileName: record.file_name,
          importedAt: record.imported_at,
          cells: [record.row_count, record.matched, record.unmatched],
        }))}
        onRemove={handleRemove}
        emptyText="No PAF files imported yet. Uploaded workbooks will appear here."
        footnote="Removing a file rebuilds client details from the remaining PAF files, oldest first. A blank cell in a later file never erases an earlier value."
      />

      <FormatGuide />
    </div>
  );
}

function PafResultCard({ result }: { result: ImportPafResult }) {
  const { displayName } = useAppData();
  const [showUnmatched, setShowUnmatched] = useState(false);
  const matched = result.matches.filter((m) => m.clientId !== null);
  const unmatched = result.matches.filter((m) => m.clientId === null);
  const issues: PafRowIssue[] = [...result.skipped, ...result.warnings, ...result.unlinked];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CheckCircle2 size={16} className="text-success" />
          <CardTitle>Imported {result.fileName}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ResultStat label="Rows" value={result.rowCount} />
          <ResultStat label="Matched to clients" value={matched.length} />
          <ResultStat label="Not yet in Sales Report" value={unmatched.length} />
          <ResultStat label="Skipped rows" value={result.skipped.length} />
          <ResultStat label="Spouse records linked" value={result.spouseLinked} />
          <ResultStat label="Corporate records linked" value={result.corporateLinked} />
        </dl>

        {unmatched.length > 0 && (
          <div>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              aria-expanded={showUnmatched}
              onClick={() => setShowUnmatched((v) => !v)}
            >
              {showUnmatched ? "Hide" : "Show"} customers not yet in the Sales Report ({unmatched.length})
            </button>
            <p className="mt-1 text-xs text-muted-foreground">
              Their details are kept and attach automatically once a Sales Report includes them.
            </p>
            {showUnmatched && (
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-3 text-xs">
                {unmatched.map(({ row }, i) => (
                  <li key={`${row.contract_number}-${i}`} className="flex justify-between gap-4">
                    <span>{row.customer_name ? displayName(row.customer_name) : "(no name)"}</span>
                    <span className="font-mono text-muted-foreground">{row.contract_number || "—"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {matched.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Example:{" "}
            <Link to={`/clients/${matched[0].clientId}`} className="text-primary hover:underline">
              view {displayName(matched[0].row.customer_name)}'s profile
            </Link>
          </p>
        )}

        {issues.length > 0 && (
          <div className="rounded-md border border-warning/30 bg-warning/[0.06] p-3 text-xs">
            <p className="mb-1 flex items-center gap-1.5 font-medium text-warning">
              <AlertTriangle size={14} aria-hidden /> {issues.length} row note{issues.length === 1 ? "" : "s"}
            </p>
            <ul className="max-h-40 space-y-0.5 overflow-y-auto text-muted-foreground">
              {issues.map((issue, i) => (
                <li key={i}>
                  {issue.sheet}, row {issue.row}: {issue.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResultStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-mono text-lg font-bold">{value}</dd>
    </div>
  );
}

function FormatGuide() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-muted-foreground" />
          <CardTitle>PAF Format Guide</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
          <li>
            Excel workbook (<strong>.xlsx</strong>) with a <strong>{PAF_SHEETS.customer}</strong> sheet: one row per
            buyer and contract.
          </li>
          <li>
            Each row needs <strong>Contract Number (Sales Report)</strong> or <strong>Customer Name (Sales Report)</strong>.
            Rows are matched to clients by contract number first, then by name.
          </li>
          <li>
            Optional <strong>{PAF_SHEETS.spouse}</strong> and <strong>{PAF_SHEETS.corporate}</strong> sheets are linked
            to buyers by <strong>Customer Number (Sales Report)</strong>, or by name.
          </li>
          <li>
            Columns are matched by header name; case, spacing and text in brackets are ignored, so "Mobile No.
            (Synthetic)" and "Mobile No." both work. Missing columns are simply left blank.
          </li>
          <li>Birthdates may be Excel dates or text in MM/DD/YYYY format.</li>
          <li>TIN and Government Issued No. columns are ignored and never stored.</li>
        </ul>
      </CardContent>
    </Card>
  );
}
