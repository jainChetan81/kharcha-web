// One place that turns a thrown value into words for the screen (React guide §4: never raw responses).
// Server functions throw plain Error messages written for people; zod and network failures do not.

/** The error's own message when it reads as a sentence, else the fallback. */
export function errorText(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  // zod's message is a JSON list of issues; fetch failures are terse English from the runtime.
  if (!message || message.startsWith("[") || message.startsWith("{") || /^(Failed to fetch|NetworkError|Load failed)/.test(message))
    return fallback;
  return message;
}
