import { PassThrough } from "stream";
import { describe, expect, it } from "vitest";
import { createApprovalHandler, parseApprovalAnswer } from "./approval";

const request = {
  attempt: 1,
  maxAttempts: 3,
  rootCause: "Typo in a method name",
  explanation: "Renamed toFixd to toFixed",
  files: ["src/index.ts", "src/math.ts"],
  diff: "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-oldline\n+newline",
};

/** A handler wired to fake streams: whatever is typed is `answers`, whatever is printed is collected. */
function setup(answers: string) {
  const input = new PassThrough();
  const output = new PassThrough();
  let printed = "";
  output.on("data", (chunk) => (printed += chunk.toString()));
  input.end(answers);
  return { handler: createApprovalHandler({ input, output }), printed: () => printed };
}

describe("parseApprovalAnswer", () => {
  it.each([
    ["y", "yes"],
    ["Y", "yes"],
    ["yes", "yes"],
    ["  YES  ", "yes"],
    ["n", "no"],
    ["no", "no"],
    ["N", "no"],
    ["", "no"], // pressing Enter alone is the safe answer
    ["m", "note"],
    ["note", "note"],
    ["maybe", "invalid"],
    ["yy", "invalid"],
    ["1", "invalid"],
  ])("reads %j as %s", (raw, expected) => {
    expect(parseApprovalAnswer(raw)).toBe(expected);
  });
});

describe("createApprovalHandler", () => {
  it("approves on yes", async () => {
    const { handler } = setup("y\n");

    expect(await handler(request)).toEqual({ approved: true });
  });

  it("declines on no, and on a bare Enter", async () => {
    expect(await setup("n\n").handler(request)).toEqual({ approved: false });
    expect(await setup("\n").handler(request)).toEqual({ approved: false });
  });

  it("declines with a note when asked to", async () => {
    const { handler, printed } = setup("m\nplease leave math.ts alone\n");

    expect(await handler(request)).toEqual({ approved: false, note: "please leave math.ts alone" });
    expect(printed()).toMatch(/note/i);
  });

  it("declines without a note when the note is left empty", async () => {
    const { handler } = setup("m\n\n");

    expect(await handler(request)).toEqual({ approved: false });
  });

  it("asks again after an answer it does not understand", async () => {
    const { handler, printed } = setup("perhaps\ny\n");

    expect(await handler(request)).toEqual({ approved: true });
    expect(printed()).toMatch(/please answer/i);
  });

  it("declines if the answers keep being unintelligible", async () => {
    const { handler } = setup("a\nb\nc\nd\ne\nf\ny\n");

    expect(await handler(request)).toEqual({ approved: false });
  });

  it("treats the input ending (no one to answer) as a no, never as a yes", async () => {
    const { handler, printed } = setup("");

    expect(await handler(request)).toEqual({ approved: false });
    expect(printed()).toMatch(/no answer/i);
  });

  it("shows what is being proposed before asking", async () => {
    const { handler, printed } = setup("n\n");

    await handler(request);

    const text = printed();
    expect(text).toContain("attempt 1/3");
    expect(text).toContain("Typo in a method name");
    expect(text).toContain("Renamed toFixd to toFixed");
    expect(text).toContain("src/index.ts, src/math.ts");
    expect(text).toContain("-oldline");
    expect(text).toContain("+newline");
    expect(text).toMatch(/Apply this change\?/);
  });

  it("can be asked about several fixes in a row from the same input", async () => {
    const { handler } = setup("n\nm\ntry another file\ny\n");

    expect(await handler(request)).toEqual({ approved: false });
    expect(await handler({ ...request, attempt: 2 })).toEqual({ approved: false, note: "try another file" });
    expect(await handler({ ...request, attempt: 3 })).toEqual({ approved: true });
  });
});
