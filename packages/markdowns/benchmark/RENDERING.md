# Browser streaming measurements

The React adapter caches serialized block signatures and incomplete-fence checks
by immutable node identity. This removes repeated traversal of completed blocks
without losing content comparisons after a full parse.

## Local comparison

Production docs build, headless Chrome on macOS arm64, October 21, 2026. The
fixture contains 100 paragraphs with emphasis and links, followed by a 40-line
TypeScript fence: 8,524 characters total. Playback appends 32 characters every
40 ms, with highlighting, line numbers, and 180 ms token fades enabled.

Three complete replays per build; the table gives medians. Counts and character
volumes were identical within each set of runs.

| Measurement over the whole replay         |    Before |    After |
| ----------------------------------------- | --------: | -------: |
| Block serialization calls                 |    16,500 |      465 |
| Serialized characters                     | 8,341,645 |  233,015 |
| Instrumented serialization time           |   23.0 ms |   2.4 ms |
| Trace `FunctionCall` time                 |  272.6 ms | 252.3 ms |
| Trace `Layout` time                       |  120.2 ms | 121.8 ms |
| Trace `Paint` time                        |  688.3 ms | 729.9 ms |
| Animation-frame interval, 95th percentile |   16.7 ms |  16.7 ms |
| Observed tasks longer than 50 ms          |         0 |        0 |

The deterministic improvement is about 97% fewer serialization calls and
serialized characters. Both builds already kept pace with a 60 Hz frame budget;
this experiment does not demonstrate a frame-rate improvement. Callback timing
ranges overlap, and paint time varies between runs. Timed playback duration is
controlled by the demo, so it is not a throughput score.

The measurements cover the entire demo page. The harness wraps `JSON.stringify`
to count Markdown nodes, samples animation-frame intervals, polls completion,
and records Chrome trace events. Instrumentation adds overhead, particularly to
many small serialization calls; the measured time is not pure native serializer
time. Trace phase totals are diagnostic categories rather than an exclusive
breakdown of all CPU work. A headless local profile does not establish behavior
on low-powered devices or real scrolling workloads.

## Reproduce

Requires the repo's `agent-browser` CLI and a running production docs demo.
Start that server using the normal docs build/start workflow, then run:

```bash
moon run markdowns:bench-render -- http://localhost:3690/markdowns current
```

An optional third argument sets the output directory. By default, the generated
fixture, three Chrome traces, and summary JSON are written under
`.agents/ignore/profiles/markdowns/`. The harness closes its browser session
when finished. Compare separately built revisions with distinct labels and
identical browser/environment settings.

The remaining candidates are layout and paint in larger messages, rendering all
code lines on each code-block update, and the known full-parse paths for long
open blocks and global definitions. Measure those workloads before adding
virtualization or changing animation behavior.

## Large browser examples

The docs Example menu now includes 100× (0.85 MB) and 1,000× (8.53 MB) versions
of the same fixture. Selecting one loads source while leaving the preview empty
and paused. Resume, Replay stream, or Show all starts rendering. Existing
highlight/fade controls stay explicit; selection does not change them. Playback
defaults to 3,200 / 32,000 characters per 40 ms step, so delivery size scales
rather than requiring hours of tiny appends. Actual elapsed time also includes
rendering work.

The browser benchmark accepts scale and run count after the output directory:

```bash
moon run markdowns:bench-render -- http://localhost:3690/markdowns large100 /tmp/markdowns-large-browser 100 1
```

Use `1000 1` for the largest browser case. The fixture is generated in the page;
it is not passed as a multi-MB command argument. Each run records its actual
size, chunk size, highlighting/fade settings, frame intervals, long tasks, and
serialization work. Large runs default to one replay and have explicit time
budgets. The harness records a failure JSON and attempts to save an interrupted
trace when a run cannot finish.

For frame comparisons, disable tracing and use at least three replays:

```bash
moon run markdowns:bench-render -- http://localhost:3690/markdowns fades /tmp/markdowns-fades 100 3 --no-trace
```

`--no-fade` and `--no-highlight` isolate those features. `--sample-dom` samples
retained animation wrappers once per second; omit it from primary timing runs.
Each replay gets a fresh browser session. Measurement starts on Replay, includes
the completion commit and a settling period for fades and observer delivery, and
reports p95/p99/max frames, long-task totals, retained wrappers, and runtime
errors. Profiler startup is excluded from these frame measurements.

Add `--pause` to pause at 85% of the source and resume after 250 ms. Phase
markers distinguish append, pause, resume, and completion tasks. Pause/resume
commit time runs from the click to the toolbar DOM update; two-frame time also
includes two animation-frame callbacks. Completion is marked after the final DOM
commit, so its `commitMs: 0` is a marker definition, not a zero-cost render.

These are deliberate capacity tests. A parser pass at 1,000× does not establish
that a full unvirtualized browser render with 1,000 live code tokenizers and
animation spans is practical. Treat timeouts or browser exhaustion as results
and keep feature settings attached to each measurement.

### Observed 100x browser result

One production headless Chrome run on macOS arm64, October 21, 2026. Both
highlighting and 180 ms fades were enabled, using 3,200 characters per step (267
updates), with the same 40 ms scheduled delay as the small fixture.

| Measurement               |  100× result |
| ------------------------- | -----------: |
| Source characters         |      852,598 |
| Full replay elapsed       | 53.6 seconds |
| Frame interval p95        |     133.3 ms |
| Maximum frame interval    |    1766.6 ms |
| Observed long tasks       |          387 |
| Block serialization calls |       20,660 |

This is a single instrumented capacity run, not a median or throughput
guarantee. The complete Chrome trace is approximately 362 MB, so tracing itself
has a cost. The small-case three-run p95 was 16.7 ms; this larger workload
clearly exceeds that frame budget. The generated 1,000× example was verified to
load paused with an empty preview, but its full DOM replay was not run. Its
parser/owned-tree results are documented in
[STREAMING.md](./STREAMING.md#large-fixtures).

### Bounded fade history

The React renderer now fades each delivered text chunk together, preserving
existing chunk timing. Finished spans merge into plain text through one shared
expiry scheduler per Markdown component. Selection intersecting a text parent
defers structural cleanup until selection clears; finished animation attributes
are still removed. Reduced motion and zero duration skip new fade allocations.
Pausing or disabling animation keeps the text component mounted so its selected
DOM nodes can survive cleanup.

Production headless Chrome on macOS arm64, October 21, 2026. Three untraced
replays before and after, 852,598 source characters, 3,200 characters per step,
40 ms requested interval, highlighting and 180 ms fades enabled. Values below
are medians across the three runs.

| Measurement               |    Before | Bounded fades |
| ------------------------- | --------: | ------------: |
| Playback elapsed          |    49.6 s |        21.7 s |
| Frame interval p95        |  116.7 ms |       33.4 ms |
| Frame interval p99        |    150 ms |         50 ms |
| Maximum frame interval    |   1350 ms |      216.6 ms |
| Tasks at least 50 ms      |       385 |             2 |
| Total long-task time      | 34,518 ms |        237 ms |
| Longest task              |    944 ms |        187 ms |
| Block serialization calls |    20,660 |        20,660 |
| Final elements            |   101,100 |       101,100 |
| Final text characters     |   657,000 |       657,000 |

This is roughly 71% lower p95 frame intervals, 56% shorter playback, and 99%
less long-task time for this fixture, with both features enabled. Final output
counts and serialization work agree in every run. No page runtime errors were
captured in the completed runs. An initial benchmark session-restart failure
occurred before navigation; it was excluded, and the harness now uses a unique
browser session name for every replay.

The normal 8,524-character fixture also completed three untraced replays with
180 ms fades and highlighting enabled: median p95/p99 16.8 ms, no long tasks,
and no retained animation wrappers after settling. This is consistent with the
earlier small-case frame pacing; it is not a controlled small-case speedup
claim.

A separate 100× run with once-per-second DOM sampling observed a peak of 1,999
retained fade spans, and zero after settling. Sampling was disabled for the
timing comparison above. Native Chromium checks also confirmed selection
preservation during expiry, pause/resume, toggling, and completion; clearing
selection released deferred spans. Reduced-motion emulation created no spans.

The full document still remains mounted, and occasional ~190 ms tasks remain.
This does not establish smooth scrolling, low-powered-device performance, or
1,000× readiness. Playback is paced after React commits, so elapsed is not a
fixed-rate producer throughput score. Whole-document memory still scales with
source size; these changes bound ordinary animation history, with a temporary
exception while selection protects existing text nodes.

### Isolated streaming lifecycle updates

Streaming activity is now separate from immutable rendering settings. Unchanged
historical blocks skip activity-only updates; a root controller stops only its
pending recent fades. Content changes, explicit rendering options, and
unfinished-block status still invalidate the corresponding block. Selected spans
remain mounted until cleanup is safe, and resume does not replay them.

Three untraced production Chrome runs per version, using the same 100× fixture,
3,200 characters per step, highlighting, and 180 ms fades. Each run includes the
same automatic late pause/resume. Values are medians unless noted.

| Measurement                                   | Bounded fades | Isolated lifecycle |
| --------------------------------------------- | ------------: | -----------------: |
| Pause click to DOM commit                     |      176.1 ms |            25.7 ms |
| Resume click to DOM commit                    |      169.0 ms |            10.4 ms |
| Pause click through two frames                |      224.3 ms |            63.7 ms |
| Resume click through two frames               |      186.9 ms |            30.8 ms |
| Pause/resume long tasks across all three runs |             6 |                  0 |
| Runs with a completion long task              |        3 of 3 |             1 of 3 |
| Frame interval p95                            |       33.4 ms |            33.4 ms |
| Frame interval p99                            |         50 ms |              50 ms |
| Reported long-task count per replay           |             4 |                  2 |
| Total long-task time per replay               |        592 ms |             152 ms |

The baseline's completion tasks were 190/180/188 ms. Updated completion had no
reported long task in two runs and one 285 ms outlier in the third. That outlier
remains unattributed. A separate diagnostic trace did not reproduce it: the
completion task took 30.4 ms, comprising 17.35 ms JavaScript and 13.02 ms
style/layout, with no GC in that task. This does not establish that the earlier
outlier was GC or that every completion is now below 50 ms.

The trace's recurring long tasks were browser frame rendering work, up to 69 ms
with tracing enabled. Steady streaming frame pacing remains about 33 ms; the
result is a reduction in lifecycle stalls, not a 60 fps or 1,000× claim. Root
block enumeration and code-line rendering remain separate candidates.

Three additional uninterrupted 100× replays reported only append long tasks (50
ms; 54/50/56 ms; 59 ms), with none at completion. Their medians were p95 33.4
ms, p99 50 ms, maximum frame interval 66.7 ms, one long task totaling 59 ms, and
22.0 s playback. The result supports reduced transition stalls; it does not show
a steady-streaming throughput or frame-rate improvement.

Three 1× replays remained near 16.7 ms p95 with no long tasks. Final element,
text, and serialization counts match the earlier measurements in every run, and
no page runtime errors were captured. Native Chromium checks passed the seven
existing scenarios plus a completed-history case: live paragraph/code fades stop
without replacing selected historical text, resume does not replay them, tail
appends preserve selection, and clearing selection allows cleanup.
