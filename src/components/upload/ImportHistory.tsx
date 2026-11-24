import type { ReactNode } from "react";
import { Files, Trash2 } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export interface ImportHistoryRow {
  id: string;
  fileName: string;
  importedAt: string;
  /** One cell per entry in `columns`. */
  cells: ReactNode[];
}

interface ImportHistoryProps {
  title: string;
  columns: string[];
  rows: ImportHistoryRow[];
  onRemove: (id: string, fileName: string) => void;
  emptyText: string;
  footnote: ReactNode;
  /** Extra non-removable rows rendered after the imports (e.g. pre-tracking baseline). */
  trailingRows?: ReactNode;
}

/** Table of imported files, newest first as given, each with a Remove button. */
export function ImportHistory({ title, columns, rows, onRemove, emptyText, footnote, trailingRows }: ImportHistoryProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Files size={16} className="text-muted-foreground" />
          <CardTitle>{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 && !trailingRows ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Imported</th>
                  {columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium break-all">{row.fileName}</td>
                    <td className="text-muted-foreground whitespace-nowrap">{formatDateTime(row.importedAt)}</td>
                    {row.cells.map((cell, i) => (
                      <td key={columns[i]} className="font-mono">
                        {cell}
                      </td>
                    ))}
                    <td className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => onRemove(row.id, row.fileName)}
                        aria-label={`Remove ${row.fileName}`}
                      >
                        <Trash2 size={14} />
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
                {trailingRows}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-3">{footnote}</p>
      </CardContent>
    </Card>
  );
}
