/**
 * The emission as a person reads it.
 *
 * A module of its own for `adopt/render.ts`'s reason: `--json` already carries
 * every field below, so this decides only how they read — and the two
 * per-scenario warnings are why that is worth separating. Both name something
 * in a scenario body that did NOT survive into the emission, while the file
 * that came out is valid Gherkin and the summary line counts it like any other.
 * They are the only place those losses are visible at all, so they must not
 * share a module with the write path that can grow past them.
 */
import { relative } from "node:path";
import { type Action, type ActionRow } from "./reconcile.js";

/** What the text view needs that the plan does not carry. */
export interface RenderContext {
  service: string;
  /** Repo-relative `<gherkinDir>/loam/`. */
  root: string;
  /** Absolute suite root — orphan paths are printed relative to it. */
  absRoot: string;
  featureId: string | null;
  dryRun: boolean;
  /** Feature ids still in flight, for naming who owns a kept file. */
  activeIds: Set<string>;
  writes: number;
  orphans: string[];
}

/**
 * `conflict` never reaches the renderer — the run refuses before it — but the
 * map is total so a future action cannot silently print `undefined`.
 */
const VERB: Record<Action, string> = {
  written: "write  ",
  replaced: "replace",
  kept: "keep   ",
  conflict: "CONFLICT",
};

/** Every per-scenario loss, in one shape: what was written, and what became of it. */
const LOSSES = [
  {
    of: (a: ActionRow): string[] => (a.action === "kept" ? [] : a.stepless),
    why:
      "has NO recognizable steps — cucumber runs it vacuously green and `verify --results` can never " +
      "confirm it; reword its body as `- **Given/When/Then**` bullets",
  },
  {
    of: (a: ActionRow): string[] => (a.action === "kept" ? [] : a.malformedExamples),
    why:
      "has a table loam could not read as Examples — the header needs its `|---|` delimiter row, every " +
      "row the header's column count, and at least one row under it — so it stayed in the description and " +
      "this scenario runs ONCE, not once per case; or rows at the margin after the table it did read — cut " +
      "off by a `#` comment or a blank line, or a second table — which are cases nothing runs: keep every " +
      "case in one unbroken table; or an `Examples:` line, after which the scenario runs no steps at all: " +
      "delete it, the margin table IS the Examples",
  },
  {
    of: (a: ActionRow): string[] => (a.action === "kept" ? [] : a.strandedBlocks),
    why:
      "wrote a fenced block or an indented table where no step precedes it, a second one under the same " +
      "step, or a table loam could not read — or a sub-bullet or a wrapped line under a step — and it " +
      "stayed in the description, so the step definition receives no payload, no data table or half its " +
      "sentence; put one block under the step it belongs to, with a `|---|` row and equal columns, write " +
      "expected rows as that table, and keep a step on one line",
  },
];

/**
 * Said once per LINE rather than per scenario, unlike the losses above: the
 * fix is rewording that one line, and a scenario can hold several.
 */
const KEYWORD_WHY =
  "cucumber refuses the file or runs what the document does not say; reword it so it does not open with " +
  "`@`, `* `, `Given `/`When `/`Then `/`And `/`But ` or `Scenario:`/`Example:`/`Rule:`/`Background:` — a step " +
  "is a `- **Given** …` bullet, a note a `- ` bullet — then run `loam gherkin` again";

export function render(actions: ActionRow[], ctx: RenderContext): void {
  const { service, root, dryRun, featureId } = ctx;
  const head = featureId === null ? `${service} (living suite)` : `${featureId} · ${service}`;
  console.log(`gherkin ${head} → ${root}/${dryRun ? "  (dry run)" : ""}\n`);
  if (actions.length === 0) {
    console.log(
      featureId === null
        ? `  the living specs hold no requirements for ${service} — nothing to emit.`
        : `  ${featureId} has no ADDED or MODIFIED requirements for ${service} — nothing to emit.`,
    );
  }
  for (const a of actions) {
    if (a.action === "kept") {
      const owners = a.kept.tags.filter((t) => ctx.activeIds.has(t));
      console.log(
        `  keep     ${a.fileName}  —  ${a.requirement.name}  (in flight: @${owners.join(" @")} — \`loam gherkin ${owners[0]}\` regenerates it)`,
      );
      continue;
    }
    const n = a.digests.length;
    const arch = a.axis.key === "archSpec" ? ", arch" : "";
    console.log(
      `  ${VERB[a.action]}  ${a.fileName}  —  ${a.requirement.name}  (${n} scenario${n === 1 ? "" : "s"}${arch})`,
    );
    for (const loss of LOSSES) {
      for (const name of loss.of(a)) console.log(`      ⚠ scenario '${name}' ${loss.why}`);
    }
    for (const k of a.keywordLines) {
      const where = k.scenario === undefined ? "the requirement's text" : `scenario '${k.scenario}'`;
      console.log(`      ⚠ ${where} has a line Gherkin reads as a tag, a step or a new scenario: \`${k.line}\` — ${KEYWORD_WHY}`);
    }
  }
  for (const o of ctx.orphans) {
    console.log(`  delete   ${relative(ctx.absRoot, o).split(/[\\/]/).join("/")}  —  no longer in this scope`);
  }
  const wrote = `${ctx.writes} file(s)`;
  const keptNote = actions.length > ctx.writes ? `, ${actions.length - ctx.writes} kept in flight` : "";
  const dropped = ctx.orphans.length > 0 ? `, ${ctx.orphans.length} deletion(s)` : "";
  console.log(
    dryRun
      ? `\n  ${wrote}${keptNote}${dropped} — dry run, nothing was written.`
      : `\n  ${wrote} written${keptNote}${dropped}. Write step definitions OUTSIDE ${root}/ — regeneration rewrites it.`,
  );
}
