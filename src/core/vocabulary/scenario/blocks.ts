/**
 * A scenario body as markdown sees it: fenced blocks, tables and plain lines,
 * classified once, in source order, before anything decides what is a step.
 *
 * Split out of `../steps.ts`, which assembles the Gherkin from these blocks:
 * reading the markdown and deciding what the runner gets are two phases, and
 * this is the first. Nothing here knows what a step is.
 */

import { fenceTracker } from "../../kernel/fences.js";

/**
 * `| a | b |` -> `["a", "b"]`; null when the line is not a pipe row at all.
 *
 * The split honours markdown's `\|` escape, and that is not a nicety: a cell
 * holding a literal pipe — a regex alternation, a Kafka key template, a shell
 * snippet — otherwise splits into two, the row's width stops matching the
 * header's, and the WHOLE table is reported unreadable. The failure lands on the
 * one row that needed the escape and reads as if the author miscounted columns.
 * `\\` unescapes too, so a cell can end in a backslash without eating the
 * delimiter after it.
 */
export function cellsOf(line: string): string[] | null {
  const t = line.trim();
  if (!/^\|.*\|$/.test(t)) return null;
  const cells: string[] = [];
  let cur = "";
  for (let i = 1; i < t.length - 1; i += 1) {
    const c = t[i]!;
    if (c === "\\" && (t[i + 1] === "|" || t[i + 1] === "\\")) {
      cur += t[i + 1]!;
      i += 1;
      continue;
    }
    if (c === "|") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

/** `|---|:--:|` — the row markdown puts under a table header. */
function isSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

/** One run of source lines, already classified by {@link blocksOf}. */
export type Block =
  | { kind: "line"; text: string }
  | { kind: "fence"; indent: number; contentType?: string; lines: string[] }
  | { kind: "table"; indent: number; rows: string[][] | null; lines: string[] };

/**
 * The scenario body split into fenced blocks, markdown tables and plain lines,
 * in source order.
 *
 * Fences are recognised FIRST and win outright, which is what stops a pipe row
 * inside a JSON payload from being hoisted out of it. That ordering is not a
 * nicety: before it existed, a scenario carrying a fenced payload that happened
 * to contain a table emitted the payload as trimmed prose and the payload's own
 * table as the scenario's `Examples`, turning one data pass into an outline
 * parameterized by the contents of its own request body — and `loam validate`
 * graded it green, because steps existed and no table was malformed.
 */
export function blocksOf(lines: string[]): Block[] {
  const out: Block[] = [];
  const fenced = fenceTracker();
  let open: { indent: number; contentType?: string; lines: string[] } | null = null;
  // The opener's marker: only the same one closes the block. `fenceTracker`
  // holds that rule; ending the block on ANY marker made the two readers in
  // this one function disagree, and a ``` payload quoting a ~~~ snippet lost
  // everything above the snippet, with nothing reported.
  let closer: string | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const inFence = fenced(line);
    const marker = /^(\s*)(```|~~~)(.*)$/.exec(line);
    if (inFence && marker && open === null) {
      const info = marker[3]!.trim();
      open = { indent: marker[1]!.length, lines: [], ...(info.length > 0 ? { contentType: info } : {}) };
      closer = marker[2]!;
      continue;
    }
    if (open !== null) {
      // The tracker still reports the CLOSING marker as fenced content, so the
      // marker line is what ends the block rather than the first unfenced line
      // after it — reading it the other way swallows the line following the
      // fence into the payload.
      if (marker && marker[2] === closer) {
        out.push({ kind: "fence", ...open });
        open = null;
        continue;
      }
      open.lines.push(line);
      continue;
    }
    const table = tableAt(lines, i);
    if (table !== null) {
      out.push({ kind: "table", indent: table.indent, rows: table.rows, lines: lines.slice(i, table.end + 1) });
      i = table.end;
      continue;
    }
    out.push({ kind: "line", text: line });
  }
  // An unterminated fence is the author's typo, not a reason to lose the text:
  // its lines go back as plain lines and land in the description.
  if (open !== null) for (const l of open.lines) out.push({ kind: "line", text: l });
  return out;
}

/**
 * The markdown table starting at `lines[i]`, or null when none does.
 * `rows` is null when a table was clearly intended and its shape cannot be read.
 */
function tableAt(lines: string[], i: number): { indent: number; end: number; rows: string[][] | null } | null {
  const header = cellsOf(lines[i] ?? "");
  // An unnamed column cannot be referenced by a `<placeholder>`, so a header
  // with an empty cell is not a header — it is prose that contains pipes.
  if (header === null || header.length === 0 || header.some((c) => c.length === 0)) return null;
  const sep = cellsOf(lines[i + 1] ?? "");
  const indent = /^\s*/.exec(lines[i]!)![0]!.length;
  if (sep === null) return null;
  if (!isSeparator(sep)) return delimiterless(lines, i, header.length, indent);
  if (sep.length !== header.length) return { indent, end: i + 1, rows: null };
  const rows: string[][] = [];
  let end = i + 1;
  for (let j = i + 2; j < lines.length; j += 1) {
    const row = cellsOf(lines[j]!);
    if (row === null) break;
    end = j;
    if (row.length !== header.length) return { indent, end, rows: null };
    rows.push(row);
  }
  // A header and a separator with nothing under them is a table that carries
  // zero cases — worse than no table, because it reads as coverage.
  if (rows.length === 0) return { indent, end, rows: null };
  return { indent, end, rows: [header, ...rows] };
}

/**
 * A table written the way a `.feature` file writes one — a named header and
 * rows of the same width under it, with no `|---|` delimiter row — as an
 * unreadable table spanning those rows; null when the run is not that shape.
 *
 * It used to be null outright, and that is the defect this exists for: the
 * rows fell through as plain lines, a Scenario Outline's table became prose
 * above its `Given`, the `<placeholders>` reached the runner as literal text,
 * and neither flag on {@link ScenarioGherkin} was set — the one shape a Gherkin
 * habit produces was the one shape nothing reported. Equal widths are the whole
 * test: a header followed by rows of other widths is not recognisably a table,
 * and prose that happens to sit between pipes must stay prose.
 *
 * The run stops short of a `|---|` row and gives back the line above it: that
 * line is the HEADER of a readable table, and swallowing it would turn a
 * working outline into an unreadable one because a pipe line sat over it.
 */
function delimiterless(
  lines: string[],
  i: number,
  width: number,
  indent: number,
): { indent: number; end: number; rows: null } | null {
  let end = i;
  for (let j = i + 1; j < lines.length; j += 1) {
    const row = cellsOf(lines[j]!);
    if (row === null || row.length !== width) break;
    if (isSeparator(row)) {
      end = j - 2;
      break;
    }
    end = j;
  }
  return end > i ? { indent, end, rows: null } : null;
}
