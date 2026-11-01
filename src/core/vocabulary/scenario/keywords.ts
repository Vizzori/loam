/**
 * Which prose lines Gherkin will not read as prose.
 *
 * Everything an author writes in a requirement or a scenario that is not a step
 * is emitted as DESCRIPTION — the requirement's text under `Feature:`, a
 * scenario's prose under its `Scenario:` — and description is the one place a
 * `.feature` file has no escape. Gherkin decides what a line is from how its
 * trimmed text BEGINS, and only falls back to "description" when nothing else
 * it expects at that point matches. So a line of prose that happens to open
 * with a keyword is not prose to the runner:
 *
 * - `@negative @edge` is a TAG LINE: under a scenario it is the next
 *   scenario's tags, the steps that follow have no scenario to belong to, and
 *   cucumber refuses the whole file. The same line in a requirement's text — a
 *   Java `@Transactional` quoted in it — breaks the file the same way.
 * - `* the window is pinned` is a STEP: `* ` is a step keyword in every
 *   dialect, so a note bulleted with a star becomes something the runner
 *   executes, and so does a sentence that opens "When two reservations race".
 * - `Example: a 10 EUR budget` starts a NEW SCENARIO, with no digest tag: the
 *   prose after it is its description, and the steps after that are its steps,
 *   not the ones the claim was stamped on. `Rule:` regroups everything under it.
 *
 * None of these can be fixed in the emitter without rewording the author's
 * text, which nothing that renders a scenario may do — so they are reported,
 * and the author rewords. The ENGLISH keywords are the ones that count: the
 * emitter writes no `# language:` header, so English is the dialect cucumber
 * reads the file in, whatever language the prose is in.
 *
 * `Examples:` (and `Scenarios:`) is deliberately absent. Under a scenario it is
 * already `malformedExamples`' to report, with its own fix; under `Feature:`
 * Gherkin does not expect it and reads it as prose.
 *
 * `core/gherkin/read.ts` keeps a near relative, `STRUCTURE_RE`, for the
 * opposite question — which lines of a file ON DISK a hand edit could add
 * structure through. The two are not the same list: that one also takes the
 * header's own `Feature:` line and a space before the colon, because it reads
 * whatever an editor saved. This rule cannot live there — `core/gherkin/` sits
 * above this package, and `core/document/` grades with it too.
 */

/** Where a description line is emitted, which decides what Gherkin expects there. */
export type DescriptionOf = "feature" | "scenario";

/** The step keywords, trailing space included — `Given:` or `Givenx` is prose. */
const STEP_KEYWORDS = ["Given ", "When ", "Then ", "And ", "But ", "* "];

/** Keywords that open a scenario, a rule or a background — always followed by `:`. */
const HEADER_KEYWORDS = ["Scenario Outline", "Scenario Template", "Scenario", "Example", "Rule"];

/**
 * Does Gherkin read this description line as something other than description?
 *
 * Under a scenario it expects steps, tags, `Examples:` and the next scenario or
 * rule; under `Feature:` it expects a background, tags, scenarios and rules.
 * Anything else is description, and is not reported — a `#` line included,
 * which is a comment: current Gherkin (31 and later) drops it and reads on,
 * while older parsers refuse a description that continues after one. That
 * older behaviour is a runner's version question, not a line to reword.
 */
export function readsAsKeyword(line: string, of: DescriptionOf): boolean {
  const text = line.trim();
  if (text.startsWith("@")) return true;
  if (HEADER_KEYWORDS.some((k) => text.startsWith(`${k}:`))) return true;
  if (of === "feature") return text.startsWith("Background:");
  return STEP_KEYWORDS.some((k) => text.startsWith(k));
}
