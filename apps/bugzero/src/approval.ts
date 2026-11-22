import type { ApprovalDecision, ApprovalHandler, ApprovalRequest } from "@opspilot/shared";
import readline from "readline";

export type ApprovalAnswer = "yes" | "no" | "note" | "invalid";

/** How many unintelligible answers are tolerated before the fix is treated as declined. */
const MAX_INVALID_ANSWERS = 5;

/** Reads what was typed at the "Apply this change?" prompt. A bare Enter means no, the safe answer. */
export function parseApprovalAnswer(raw: string): ApprovalAnswer {
  const answer = raw.trim().toLowerCase();
  if (answer === "y" || answer === "yes") return "yes";
  if (answer === "" || answer === "n" || answer === "no") return "no";
  if (answer === "m" || answer === "note") return "note";
  return "invalid";
}

/**
 * Builds the handler that `rescue --approve` uses: it shows a proposed fix and its diff, then asks whether to
 * apply it (yes, no, or no with a note for the AI). Anything but a clear yes, including the input ending, declines.
 * The streams are parameters so it can be tested without a terminal; the CLI passes stdin and stderr.
 */
export function createApprovalHandler(io: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream }): ApprovalHandler {
  const lines = readline.createInterface({ input: io.input, terminal: false })[Symbol.asyncIterator]();

  /** The next line typed, or undefined once the input has ended. */
  const ask = async (question: string): Promise<string | undefined> => {
    io.output.write(question);
    const next = await lines.next();
    return next.done ? undefined : next.value;
  };

  return async (request: ApprovalRequest): Promise<ApprovalDecision> => {
    io.output.write(
      [
        "",
        `Proposed fix (attempt ${request.attempt}/${request.maxAttempts})`,
        `  Root cause:   ${request.rootCause}`,
        `  Explanation:  ${request.explanation}`,
        `  Files:        ${request.files.join(", ")}`,
        "",
        request.diff,
        "",
        "",
      ].join("\n")
    );

    for (let invalid = 0; invalid < MAX_INVALID_ANSWERS; ) {
      const raw = await ask("Apply this change? [y] yes  [n] no  [m] no, and leave a note for the AI  (Enter = no): ");
      if (raw === undefined) {
        io.output.write("\nNo answer, so the change was not applied.\n");
        return { approved: false };
      }

      const answer = parseApprovalAnswer(raw);
      if (answer === "yes") return { approved: true };
      if (answer === "no") return { approved: false };
      if (answer === "note") {
        const note = (await ask("Note for the AI: "))?.trim();
        return note ? { approved: false, note } : { approved: false };
      }

      invalid++;
      io.output.write("Please answer y, n or m.\n");
    }
    io.output.write("Too many unclear answers, so the change was not applied.\n");
    return { approved: false };
  };
}
