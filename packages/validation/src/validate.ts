export function validate(results: any[]) {
  return results.every((x) => x.success);
}