/**
 * What counts as a Gherkin step in a scenario body, and what counts as that
 * step's ARGUMENT — the one rule `loam gherkin` emits by and `loam validate`
 * grades by.
 *
 * It lives in a leaf of its own because both of those readers need it and they
 * sit on opposite sides of an import: `spec.ts` parses the markdown a scenario
 * is written in, `gherkin/emit.ts` renders that scenario into a `.feature` file and
 * parses requirements back out of `spec.ts` to do it. With the detector inside
 * `gherkin/emit.ts`, asking "does this scenario have any steps?" from the parser made
 * the two modules import each other, and a module-evaluation cycle is decided by
 * whichever entry point happens to be loaded first.
 *
 * Nothing here reads a file or knows what a requirement is: it is text in, shape
 * out, so both sides can depend on it and neither has to depend on the other.
 * The markdown reading underneath — fences, tables, plain lines — is
 * `./scenario/blocks.ts`, whose `fenceTracker` comes from `core/kernel/`, the
 * one package below everything, for the same reason — `core/document/` already
 * depends on this file, so borrowing the fence rule from `core/document/parse.ts`
 * would close a package cycle.
 */

import { blocksOf } from "./scenario/blocks.js";

const STEP_KEYWORD_RE = /^(given|when|then|and|but)$/i;

export interface Step {
  /** Canonical Gherkin keyword: Given / When / Then / And / But. */
  keyword: string;
  /** The rest of the line, trimmed. May be empty. */
  text: string;
}

/**
 * Is this scenario body line a step? A step is a LIST BULLET (`-`, `*`, `+`)
 * whose text opens with Given/When/Then/And/But — case-insensitive, so the
 * OpenSpec `- **WHEN** ...` convention counts — where the keyword may be
 * wrapped in `**bold**` and may carry a trailing colon. The keyword must stand
 * alone before the step text (`- Givenx` is prose). Everything that is not a
 * step stays scenario description: prose is never dropped, only steps are
 * promoted.
 */
export function stepFromLine(line: string): Step | null {
  const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
  if (!bullet) return null;
  const rest = bullet[1]!;
  const bold = /^\*\*([^*]+?)\*\*\s*(.*)$/.exec(rest);
  let lead: string;
  let tail: string;
  if (bold) {
    lead = bold[1]!.trim();
    tail = bold[2]!;
  } else {
    const sp = /^(\S+)\s*(.*)$/.exec(rest);
    if (!sp) return null;
    lead = sp[1]!;
    tail = sp[2]!;
  }
  const kw = STEP_KEYWORD_RE.exec(lead.replace(/:$/, ""));
  if (!kw) return null;
  const word = kw[1]!.toLowerCase();
  return { keyword: word[0]!.toUpperCase() + word.slice(1), text: tail.trim() };
}

/** A Gherkin `Examples` table: the column names, then one row of values per case. */
export interface Examples {
  header: string[];
  rows: string[][];
}

/**
 * A fenced block written under a step — Gherkin's docstring argument, and the
 * only way to put a request body, an expected JSON document or any other
 * multi-line literal into a scenario.
 *
 * `lines` are NOT trimmed beyond removing the fence's own indentation, and that
 * asymmetry with every other line in this module is the whole point: a payload
 * whose leading whitespace has been eaten is a payload no step definition can
 * compare against, and the loss is invisible because the file still parses.
 */
export interface DocString {
  /** The fence's info string (` ```json ` -> "json"), absent when it carried none. */
  contentType?: string;
  lines: string[];
}

/** One step as it will be emitted, with the argument written under it, if any. */
export interface EmittedStep {
  /** The rendered step line: keyword then text — `Given a payment of 100.00`. */
  text: string;
  docstring?: DocString;
  /**
   * An INDENTED markdown table written under this step, as Gherkin's data-table
   * argument: every row including the header, with the markdown separator row
   * dropped. Markdown needs the separator to render at all, Gherkin has no such
   * row, and the source stays legible in a pull request either way.
   */
  table?: string[][];
}

export interface ScenarioGherkin {
  description: string[];
  steps: EmittedStep[];
  /** The cases a `Scenario Outline` runs, or null for a plain `Scenario`. */
  examples: Examples | null;
  /**
   * A top-level table was clearly intended as `Examples` and could not be read —
   * a row whose width disagrees with the header, a header with no rows under
   * it, or rows written the way a `.feature` file writes them, with no `|---|`
   * delimiter row. Also set by a body line reading `Examples:`: that keyword is
   * the emitter's to write, and one kept as description ends the scenario
   * early — cucumber refuses the file.
   *
   * Reported rather than guessed at. The rule this whole module holds is that
   * prose is never dropped, so a table loam cannot read stays in the scenario
   * DESCRIPTION and the emission is still valid Gherkin — which is exactly why
   * silence would be wrong: the author wrote twenty cases, cucumber runs one
   * scenario, and both the file and the report look healthy.
   *
   * The delimiter-less table is NOT read as `Examples`, though nothing about
   * its shape is ambiguous. Markdown does not render it as a table — a pull
   * request shows a paragraph of pipes — so accepting it would make the
   * document a reviewer approved and the test the runner executes say two
   * different things, which is the one disagreement loam exists to prevent.
   */
  malformedExamples: boolean;
  /**
   * A fenced block or an indented table was written where it cannot become a
   * step argument — before the scenario's first step, or (for a table) in a
   * shape this module cannot read. It stays in the description, so nothing is
   * lost from the DOCUMENT, and everything is lost from the TEST: the payload
   * reaches no step definition and the runner sees a step with no argument.
   *
   * A separate flag from `malformedExamples` because the fixes are different —
   * one is "move it under a step", the other is "give the table equal columns" —
   * and a machine must not have to guess which was meant.
   */
  strandedBlocks: boolean;
}

/**
 * A body line that reads as Gherkin's own `Examples:` keyword (or its synonym
 * `Scenarios:`). The emitter writes that keyword itself, above the table it
 * read; one written by the author is kept as description, and a description
 * line that IS a keyword ends the scenario there — cucumber then meets the
 * steps after an `Examples:` with no table and refuses the whole file.
 */
const EXAMPLES_KEYWORD_RE = /^(?:Examples|Scenarios)\s*:/;

/**
 * A scenario body split for rendering: bullet lines that read as steps become
 * steps, a fenced block or an INDENTED table under a step becomes that step's
 * argument, a table at the body's own left margin becomes the `Examples` of a
 * `Scenario Outline`, and every other non-blank line is kept (edge-trimmed) as
 * the scenario's description. Description renders BEFORE the steps whatever the
 * source order — Gherkin's grammar ends a description at the first step keyword
 * — so prose survives verbatim but interleaving does not.
 *
 * INDENTATION IS THE WHOLE DISAMBIGUATION, and it is one rule an author can
 * hold in their head: a table written under a step, indented the way markdown
 * already asks you to indent anything belonging to a list item, is that step's
 * data table; a table at the margin is the scenario's case matrix. Before this
 * rule existed there was only the second reading, so `Then the ledger holds:`
 * followed by its expected rows silently became a two-case outline and the step
 * reached the runner with no argument at all.
 *
 * The table matters more than it looks in both roles. A permission matrix, a
 * validation matrix, a status-code table — the shape most of a service's
 * decision layer actually has — is one parameterized test in the code it came
 * from and one outline here. And an expected-state table is how a component
 * test says what a row, a topic or an outbox must hold after one data pass;
 * without it that assertion is prose, and prose asserts nothing.
 *
 * ONLY THE FIRST top-level table is `Examples`. Gherkin permits several
 * `Examples` blocks per outline, and supporting them would make "which table is
 * the outline's" a question with no answer in markdown; a second one keeps its
 * prose exactly as it reads today.
 */
export function scenarioGherkin(lines: string[]): ScenarioGherkin {
  const description: string[] = [];
  const steps: EmittedStep[] = [];
  let examples: Examples | null = null;
  let malformedExamples = false;
  let strandedBlocks = false;
  let examplesKeyword = false;
  const keep = (raw: string[]): void => {
    for (const l of raw) if (l.trim().length > 0) description.push(l.trim());
  };
  for (const block of blocksOf(lines)) {
    if (block.kind === "line") {
      if (block.text.trim().length === 0) continue;
      const step = stepFromLine(block.text);
      if (step) steps.push({ text: step.text.length > 0 ? `${step.keyword} ${step.text}` : step.keyword });
      else {
        // A flag of its own, folded in at the end: `malformedExamples` also
        // decides whether a later margin table may still become the
        // `Examples`, and the keyword line says nothing about that table.
        if (EXAMPLES_KEYWORD_RE.test(block.text.trim())) examplesKeyword = true;
        description.push(block.text.trim());
      }
      continue;
    }
    const last = steps[steps.length - 1];
    if (block.kind === "fence") {
      if (last === undefined) {
        strandedBlocks = true;
        keep(block.lines);
        continue;
      }
      last.docstring = {
        ...(block.contentType === undefined ? {} : { contentType: block.contentType }),
        lines: block.lines.map((l) => l.slice(0, block.indent).trim().length === 0 ? l.slice(block.indent) : l.trimStart()),
      };
      continue;
    }
    // A table at the margin answers to the scenario; an indented one answers to
    // the step above it. Either can be unreadable, and an unreadable one keeps
    // its prose rather than being guessed at.
    if (block.indent === 0 && examples === null && !malformedExamples) {
      if (block.rows === null) {
        malformedExamples = true;
        keep(block.lines);
      } else examples = { header: block.rows[0]!, rows: block.rows.slice(1) };
      continue;
    }
    if (block.indent > 0 && block.rows !== null && last !== undefined) {
      last.table = block.rows;
      continue;
    }
    if (block.indent > 0) strandedBlocks = true;
    keep(block.lines);
  }
  return { description, steps, examples, malformedExamples: malformedExamples || examplesKeyword, strandedBlocks };
}
