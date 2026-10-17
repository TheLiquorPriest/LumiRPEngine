// Build-time findings. Validation collects every problem and the build fails once with all of
// them, so a bad source shows its whole damage in one run.

/** What kind of rule a finding breaks. */
export type Rule =
  /** A value does not fit its column type, enum or shape. */
  | "type"
  /** A value or column disagrees with its unit (integer cents, consumption unit, name suffix). */
  | "unit"
  /** A `{min, typical, max}` band is not ordered `min ≤ typical ≤ max`. */
  | "band"
  /** A reference does not resolve to a row of the target table. */
  | "ref"
  /** A row id or table id is used twice. */
  | "duplicate"
  /** An invariant sum is off (kit pieces, the 45-piece mechanic toolbox). */
  | "sum"
  /** A row has a column the mapping does not declare, or lacks a required one. */
  | "column"
  /** A source file is missing, malformed or has a field no mapping consumes. */
  | "source";

export interface Issue {
  table: string;
  row: string | null;
  column: string | null;
  rule: Rule;
  message: string;
}

export interface Where {
  row?: string;
  column?: string;
}

/** Records one finding for the table being built. */
export type Report = (rule: Rule, message: string, where?: Where) => void;

export function reporter(issues: Issue[], table: string): Report {
  return (rule, message, where) => {
    issues.push({ table, row: where?.row ?? null, column: where?.column ?? null, rule, message });
  };
}

export class TableBuildError extends Error {
  constructor(readonly issues: readonly Issue[]) {
    super(
      `table build failed with ${issues.length} issue(s):\n` +
        issues.map((i) => `  [${i.rule}] ${i.table}${i.row === null ? "" : `/${i.row}`}${i.column === null ? "" : `.${i.column}`}: ${i.message}`).join("\n"),
    );
    this.name = "TableBuildError";
  }
}
