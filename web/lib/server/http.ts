/**
 * Response shapes. Every failure is `{ error }` with a machine-readable code,
 * so the SDK can act on it rather than parse prose, plus an optional `detail`
 * for whoever is reading logs.
 */

export function json(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function fail(status: number, error: string, detail?: string): Response {
  return json(detail ? { error, detail } : { error }, status);
}

/** Parse a body that has already been read as text. */
export function parseJson(body: string): Record<string, unknown> | null {
  if (!body) return null;
  try {
    const value = JSON.parse(body);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A positive integer from a route segment, or null if it is not one. */
export function toId(raw: string | undefined): number | null {
  if (!raw || !/^[0-9]+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
