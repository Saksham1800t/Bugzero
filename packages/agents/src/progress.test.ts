import { describe, expect, it } from "vitest";
import { describeSnapshot, isProgress, recordAttempt, snapshotOf, startTracking, type PipelineStep } from "./progress";

const tsErrors = (count: number) =>
  Array.from({ length: count }, (_, i) => `src/a.ts(${i + 1},1): error TS2304: Cannot find name 'x${i}'.`).join("\n");

const eslintErrors = (count: number) =>
  "/p/src/a.ts\n" + Array.from({ length: count }, (_, i) => `  ${i + 1}:1  error  'x${i}' is not defined  no-undef`).join("\n");

const snap = (step: PipelineStep, output: string) => snapshotOf(step, output);

describe("snapshotOf", () => {
  it("counts the errors it can parse", () => {
    expect(snap("build", tsErrors(3)).errorCount).toBe(3);
    expect(snap("lint", eslintErrors(2)).errorCount).toBe(2);
  });

  it("has no count for output in a format it does not parse", () => {
    expect(snap("build", "Segmentation fault, core dumped").errorCount).toBeNull();
  });

  it("ignores colours and line endings when comparing outputs", () => {
    const a = snap("build", "\u001b[31mboom\u001b[0m\r\nline two\r\n");
    const b = snap("build", "boom\nline two");
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});

describe("isProgress", () => {
  const same = (output: string) => snap("build", output);

  it("is progress when the same step has fewer errors", () => {
    const before = same(tsErrors(5));
    expect(isProgress(before, before, same(tsErrors(4)))).toBe(true);
  });

  it("is not progress when the error count is flat", () => {
    const before = same(tsErrors(3));
    expect(isProgress(before, before, same(tsErrors(3)))).toBe(false);
  });

  it("is not progress when the error count grew", () => {
    const before = same(tsErrors(3));
    expect(isProgress(before, before, same(tsErrors(6)))).toBe(false);
  });

  it("is progress when the failing step moved later, even with more errors", () => {
    const build = snap("build", tsErrors(1));
    expect(isProgress(build, build, snap("lint", eslintErrors(20)))).toBe(true);
    const lint = snap("lint", eslintErrors(1));
    expect(isProgress(lint, lint, snap("test", "● a test failed"))).toBe(true);
  });

  it("is not progress when the failing step moved back to an earlier one", () => {
    const lint = snap("lint", eslintErrors(1));
    expect(isProgress(lint, lint, snap("build", tsErrors(1)))).toBe(false);
  });

  describe("when the errors cannot be counted", () => {
    it("counts a different output as progress, because it cannot tell better from worse", () => {
      const before = same("weird failure A");
      expect(isProgress(before, before, same("weird failure B"))).toBe(true);
    });

    it("does not count the very same output as progress", () => {
      const before = same("weird failure A");
      expect(isProgress(before, before, same("weird failure A\n"))).toBe(false);
    });

    it("does not count a return to the previous output as progress", () => {
      const best = same("weird failure A");
      const last = same("weird failure B");
      expect(isProgress(best, last, same("weird failure B"))).toBe(false);
      expect(isProgress(best, last, same("weird failure A"))).toBe(false);
    });
  });
});

describe("recordAttempt", () => {
  it("starts from the first result when there is nothing to compare to", () => {
    const tracker = recordAttempt(null, snap("build", tsErrors(3)));
    expect(tracker.stagnantAttempts).toBe(0);
  });

  it("resets the count whenever the best result is beaten", () => {
    let tracker = startTracking(snap("build", tsErrors(5)));
    tracker = recordAttempt(tracker, snap("build", tsErrors(5)));
    expect(tracker.stagnantAttempts).toBe(1);
    tracker = recordAttempt(tracker, snap("build", tsErrors(2)));
    expect(tracker.stagnantAttempts).toBe(0);
    expect(tracker.best.errorCount).toBe(2);
  });

  it("counts every attempt that does not beat the best, including a fall back to the old count", () => {
    let tracker = startTracking(snap("build", tsErrors(4)));
    tracker = recordAttempt(tracker, snap("build", tsErrors(2))); // progress
    tracker = recordAttempt(tracker, snap("build", tsErrors(6))); // worse
    tracker = recordAttempt(tracker, snap("build", tsErrors(4))); // better than last, not than best
    expect(tracker.stagnantAttempts).toBe(2);
    expect(tracker.best.errorCount).toBe(2);
  });

  it("keeps shrinking counts running as long as each attempt helps", () => {
    let tracker = startTracking(snap("build", tsErrors(9)));
    for (const count of [7, 5, 3, 1]) tracker = recordAttempt(tracker, snap("build", tsErrors(count)));
    expect(tracker.stagnantAttempts).toBe(0);
  });
});

describe("describeSnapshot", () => {
  it("says how many errors and where", () => {
    expect(describeSnapshot(snap("build", tsErrors(1)))).toBe("1 error in build");
    expect(describeSnapshot(snap("lint", eslintErrors(3)))).toBe("3 errors in lint");
    expect(describeSnapshot(snap("build", "odd"))).toBe("output it cannot count in build");
  });
});
