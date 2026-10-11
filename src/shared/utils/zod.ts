import { ZodError } from "zod";

/**
 * Formats Zod validation issues into a field-keyed error dictionary.
 * Supports dot-separated nested paths, schema keys, and fallback '_general' keys.
 */
export function formatZodErrors(error: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    let key = issue.path.join(".");
    if (!key) {
      if (
        "keys" in issue &&
        Array.isArray((issue as { keys?: unknown[] }).keys)
      ) {
        key = ((issue as { keys: unknown[] }).keys).join(".");
      } else {
        key = "_general";
      }
    }
    if (!errors[key]) {
      errors[key] = [];
    }
    errors[key].push(issue.message);
  }
  return errors;
}
