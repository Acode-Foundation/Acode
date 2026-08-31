# CodeMirror rendering benchmarks

These scripts create disposable in-memory files and drive the real Acode
editor in a debuggable Android WebView. They restore the previously active
file and remove the fixture after each run.

```sh
adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
node utils/benchmarks/editorRenderingBenchmark.mjs --runs=10 --cpu=1
node utils/benchmarks/editorFlingBenchmark.mjs --runs=10 --cpu=4
node utils/benchmarks/editorEditHighlightBenchmark.mjs --runs=10 --cpu=1
```

The rendering and fling scripts accept `--port`, `--cpu`, `--runs`, `--lines`, and
`--fixture=javascript|html|wrapped|long-line`. The rendering benchmark also
accepts `--wait=<milliseconds>` and `--details=false`. The fling benchmark
accepts `--speed` and `--distance` in CSS pixels per second and CSS pixels. The
fling benchmark bounds the requested finger travel to 60% of the editor height
and sends trusted DevTools touch start/move/end events. It records DevTools
screencast frames and checks the actual composited editor region for
background-only frames; its older DOM-node counters remain as a secondary
diagnostic only.

The edit/highlight benchmark accepts the shared fixture options plus `--edits`,
`--interval`, and `--wait`. It types into a disposable mid-document viewport
and records synchronous dispatch time, every-frame colored-line coverage,
provisional generation churn, and the exact-tree idle handoff.

## 2026-08-31 Motorola edge 70 fusion results

The pre-change APK used persistent `will-change: transform` and
`content-visibility: auto`. The retained candidate reports `auto` and
`visible`, respectively.

| 120k-line JavaScript scrollbar jumps | Blank frames | Text p95 | Color p95 | Missing color |
| --- | ---: | ---: | ---: | ---: |
| Pre-change, native CPU, 10 runs | 0 | 79.7 ms | 265.0 ms | 9/30 |
| Retained candidate, native CPU, 10 runs | 0 | 137.2 ms | 137.2 ms | 0/30 |
| Rejected render-first candidate, native CPU, 10 runs | 0 | 149.2 ms | 149.2 ms | 0/30 |
| Rejected render-first candidate, 4x CPU, 10 runs | 0 | 231.0 ms | 503.0 ms | 0/30 |

The synchronous render-first scrollbar candidate was removed because it
exceeded both the 100 ms p95 target and the 20% baseline-latency limit.

| Retained candidate touch flings | Blank frames | Plain at rest | Largest sampled frame gap |
| --- | ---: | ---: | ---: |
| Native CPU, 10 runs | 0 | 0/10 | 397.8 ms |
| 4x CPU, 10 runs | 0 | 1/10 | 1416.7 ms |
| 6x CPU, 3 diagnostic runs | 0 | 0/3 | 623.2 ms |

One-run disposable fixture probes produced no blank frames. At native CPU,
text/color latency was 147.1/187.7 ms for mixed HTML, 84.8/84.8 ms for
wrapped JavaScript, and 23.7/23.7 ms for very long lines. At 4x CPU it was
401.2/675.6 ms, 230.5/230.5 ms, and 103.2/103.2 ms, respectively.

These measurements pass the native blank-frame gate but not the latency,
4x terminal-color, or five-second exact-tree handoff gates. The branch is an
experiment and is not release-ready.

## Render-gated Android touch controller

The final debug APK enables `controlledTouchScroll` with a four-screen cap.
DevTools confirmed computed `touch-action: pan-x`; `will-change` remained
`auto` and `content-visibility` remained `visible`.

| Fixture | CPU | Runs | Composited blank frames | Plain at rest | Largest sampled gap |
| --- | ---: | ---: | ---: | ---: | ---: |
| 120k JavaScript | native | 10 | 0 | 0/10 | 419.7 ms |
| 120k JavaScript | 4x | 10 | 0 | 0/10 | 1237.9 ms |
| 120k mixed HTML/CSS/JS | native / 4x | 3 + 3 | 0 | 0/6 | 425.6 ms |
| 120k wrapped JavaScript | native / 4x | 3 + 3 | 0 | 6/6 | 11865.7 ms |
| 2000 very-long lines | native / 4x | 3 + 3 | 0 | 0/6 | 111.3 ms |
| 120k JavaScript diagnostic | 6x | 3 | 0 | 0/3 | 320.1 ms |

The first wrapped-line candidate exposed a CodeMirror height-map correction
that converted a small controlled movement into a 395k-pixel scroll jump and
one background-only compositor frame. Clamping anchor corrections to the
already rendered bounds removed both the blank frame and the catch-up jump in
the retained build. The stress fixture still misses the input-latency and
provisional-highlighting gates, and native JavaScript gesture response was
90.8 ms p95 rather than the 50 ms target. These results support retaining the
experiment, not enabling it as a release default before testing on a real
2–3 GB Android device.

## Android spline momentum candidate

The owned momentum loop now follows Android API 36's `OverScroller` spline and
uses committed scroll positions for release velocity. Spline distance is
discarded after a frame delay above 32 ms or when prepared DOM ends; such runs
are reported as render-limited rather than being compared to the unconstrained
Android distance/duration model. CodeMirror scroll-anchor corrections are
pinned to the last controlled offset until the corridor is released.

| Trusted-touch probe | Runs | Composited blank frames | Catch-up jumps | Plain at rest | Worst gesture response |
| --- | ---: | ---: | ---: | ---: | ---: |
| 120k JavaScript, native, medium | 10 | 0 | 0 | 0/10 | 543.8 ms |
| 120k JavaScript, 4x, medium | 10 | 0 | 0 | 0/10 | 935.9 ms |
| 120k JavaScript, 6x diagnostic, medium | 3 | 0 | 0 | 0/3 | 179.4 ms |
| HTML, wrapped, and long-line, native + 4x | 6 | 0 | 0 | 0/6 | 317.2 ms |

Three fast native JavaScript flings also produced no compositor blanks or
catch-up jumps. All measured 120k-line spline runs encountered at least one
delayed frame and were therefore shortened or suppressed by the render gate;
there was no valid unconstrained physical run for the 15% distance/duration
comparison. Unit snapshots cover the exact Android model separately.

The no-blank/no-catch-up objective passed these probes, but the 50 ms gesture
response and 100/150 ms stall gates did not. At 4x, the long-line fixture also
showed transient unhighlighted frames, though highlighting was present at
rest. This remains an experiment and still requires validation on a physical
2–3 GB Android device before release consideration.

## 2026-08-31 Galaxy A51 stabilization candidate

This candidate prewarms a one-screen symmetric DOM and highlight corridor,
retains mapped edit decorations until an atomic provisional replacement is
ready, and intersects momentum's safe range with both rendered and published
highlight coverage. Uncovered momentum is discarded rather than replayed.

| Native 120k JavaScript probe | Runs | Blank frames | Plain frames | Catch-up jumps |
| --- | ---: | ---: | ---: | ---: |
| Alternating trusted-touch flings | 10 | 0 | 0 | 0 |
| Ten edits per run | 10 | n/a | 0 | n/a |

Idle prewarming completed in all ten fling runs and took 325.6–553.1 ms after
the benchmark's stable-viewport gate. Every one of the 100 edit samples kept a
colored-line ratio of 1.0; maximum synchronous edit dispatch was 73.9 ms.
Single-run HTML, wrapped-line, and very-long-line fling probes also produced no
blank, plain, or catch-up frames. Their corresponding edit probes never showed
a completely plain frame.

The visual-stability gates pass, but the release gates do not. Controller
first-movement p95 was approximately 76.0 ms (91.3 ms worst), browser-observed
gesture response was slower, and all ten momentum runs ended render-limited.
The largest sampled movement gap was 260.4 ms. Exact canonical highlighting did
not reach the midpoint within five seconds in any of the ten 120k JavaScript
runs, though the atomic provisional tree remained colored; the smaller
very-long-line fixture did hand off exactly. The Galaxy A51 used for this run
has roughly 6 GB RAM, so a genuine 2–3 GB device is still required before any
release decision.

On the exact final APK, a one-run 2x CPU diagnostic retained zero blank/plain
frames but needed 109.9 ms for its first controlled movement. At 4x the idle
prewarm did not become ready within five seconds; the controller correctly
committed no movement and exposed no compositor blank, but the DOM sampler saw
21 plain initialization frames before colors recovered. The 4x diagnostic
therefore remains a failed stress gate.
