# Evaluation guide

Read this guide when planning or interpreting an actual evaluation, comparing
a candidate with no skill or an earlier version, improving discovery from
examples, or validating scripts and other executable resources. Routine skill
creation still needs only the concise proposed cases required by `SKILL.md`.

## Separate development from assessment

Classify examples before using them:

- **Behavioral or development examples** may define requirements, expose
  failures, and shape the skill. They are useful evidence but are not held out.
- **Held-out cases** are not used to write or tune the candidate. Use them for
  forward assessment after the draft is fixed.

When the user supplies examples without a designation, treat them as
behavioral examples. Propose fresh assessment cases rather than relabeling
those examples as independent evidence. Keep evaluator criteria outside the
raw prompts sent to the evaluated agent.

Use realistic inputs in the form users or workflows will actually submit.
Cover positive triggers, plausible near misses, and important ambiguity or
failure paths. Include held-out variants that exercise the same capability
without copying surface details from development examples. Do not optimize a
skill around a tiny visible test set.

## Evaluate distinct layers

Assess these separately so one success does not conceal another failure:

1. **Package validity:** frontmatter, paths, schema, and resource presence.
2. **Discovery:** whether in-scope prompts select the skill and near misses do
   not. A near miss should still receive an appropriate ordinary response.
3. **Task behavior:** whether outputs satisfy observable domain and output
   criteria after the correct selection decision.
4. **Executable support:** whether scripts or machine-consumed resources work
   in the confirmed target environment.

A format check does not establish useful behavior. Likewise, good task output
on a manually forced run does not establish accurate discovery.

Verify executable support separately when a compatible route exists. Run
scripts against representative valid, invalid, and boundary inputs; inspect
outputs, failure behavior, exit status where applicable, and declared
dependencies. Confirm that referenced schemas, templates, or lookup resources
can be loaded and are consistent with the instructions. If these checks were
not run, report them as unverified rather than inferring success from source
inspection.

## Compare fairly

When comparison is useful, evaluate the candidate against the relevant
baseline: no skill for a new capability, or the previous version for a
revision. Keep model or route, settings, tools, permissions, input set, and
rubric aligned. Use multiple samples when nondeterminism could affect the
conclusion.

Use blind comparison when quality judgments are subjective and blinding is
practical. Remove candidate identity, randomize presentation order, and ask an
independent evaluator to apply the same criteria. Blind comparison is usually
unnecessary for deterministic schema checks or objective calculations.

Do not impose a large benchmark or repeated optimization loop on a simple
skill. Choose enough cases and samples to exercise consequential behavior,
and expand only when risk, variability, or observed failures justify it.

## Report bounded conclusions

Record enough context to interpret measured results:

- candidate and baseline versions;
- evaluated model or route and relevant settings;
- tools and permissions available during the run;
- case source and whether cases were development or held out;
- sample counts and handling of nondeterminism;
- rubric, evaluator method, and any blinding;
- observed failures, uncertainty, and unverified resources.

Report counts, rates, preferences, latency, or cost only when actually
measured. Phrase conclusions as applying to the recorded setup and sample.
Do not claim that a skill, model, or provider is universally best, perfectly
reliable, or compatible outside the evaluated environment.
