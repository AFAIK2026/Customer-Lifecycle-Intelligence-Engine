import type { CellValue, WorkbookSheet } from "@/lib/paf";

export const MAX_PAF_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Reads every sheet of an .xlsx file into plain cell grids.
 *
 * The Excel reader is loaded on demand, so it only downloads when someone
 * actually uploads a PAF and doesn't add to the main bundle.
 */
export async function readWorkbook(file: File): Promise<WorkbookSheet[]> {
  if (!/\.xlsx$/i.test(file.name)) {
    throw new Error("Expected an Excel workbook (.xlsx). Older .xls files must be re-saved as .xlsx.");
  }
  if (file.size > MAX_PAF_FILE_BYTES) {
    throw new Error(`File is larger than ${MAX_PAF_FILE_BYTES / 1024 / 1024} MB`);
  }

  const { default: readXlsxFile } = await import("read-excel-file/browser");
  try {
    const sheets = await readXlsxFile(file);
    return sheets.map((s) => ({ name: s.sheet, rows: s.data as CellValue[][] }));
  } catch (e) {
    console.error(`Failed to read workbook ${file.name}:`, e);
    throw new Error("The file could not be read as an Excel workbook. Check that it opens in Excel and is saved as .xlsx.");
  }
}
