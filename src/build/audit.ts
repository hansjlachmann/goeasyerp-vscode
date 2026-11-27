import { join } from 'node:path';
import type { Problem } from '../base/problems';

export interface Finding extends Problem {
  /** Approved on the server for this source: reported, but not refused. */
  excepted: boolean;
}

export interface Audit {
  findings: Finding[];
  notes: string[];
}

interface Report {
  findings?:
    | {
        rule?: string;
        file?: string;
        line?: number;
        key?: string;
        detail?: string;
        excepted?: boolean;
      }[]
    | null;
  notes?: string[] | null;
}

/** The findings of `app-audit -json`, placed in the app's files. */
export function readAudit(output: string, appDirectory: string): Audit {
  const reports = JSON.parse(output) as Report[];
  if (!Array.isArray(reports)) {
    throw new Error('The app audit gave no reports');
  }
  return {
    findings: reports
      .flatMap((report) => report.findings ?? [])
      .map((finding) => ({
        file: join(appDirectory, finding.file || 'application.yaml'),
        line: finding.line || 1,
        message: `[${finding.rule}] ${finding.detail} (${finding.key})`,
        excepted: finding.excepted === true,
      })),
    notes: reports.flatMap((report) => report.notes ?? []),
  };
}
