export interface CommandResult {
  success: boolean;
  output: string;
  /** True when the step was not run because the project doesn't define that script. */
  skipped?: boolean;
}

export async function runCommand(
  command: string,
  cwd?: string
): Promise<CommandResult> {
  // Dynamic import because execa v7+ is ESM-only
  const { execa } = await import("execa");

  try {
    const result = await execa(command, {
      shell: true,
      cwd: cwd ?? process.cwd(),
      all: true,
      env: {
        ...process.env,
        CI: "true",
      },
    });

    return {
      success: true,
      output: result.all ?? result.stdout,
    };
  } catch (err: any) {
    return {
      success: false,
      output: err.all ?? err.stderr ?? err.stdout ?? err.message,
    };
  }
}