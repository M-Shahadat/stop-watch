export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store");
  return Response.json(data, { status, headers: responseHeaders });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export async function body(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new ApiError(422, "Invalid JSON body");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(422, "Expected a JSON object");
  }
  return value as Record<string, unknown>;
}

export function textField(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new ApiError(422, `${name} must be a string of at most ${maxLength} characters`);
  }
  return value;
}

export function uuidField(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(422, `${name} must be a UUID`);
  }
  return value;
}

export function colorField(value: unknown): string {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new ApiError(422, "Color must be a six-digit hex value");
  }
  return value;
}

export function timeField(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new ApiError(422, `${name} must be HH:MM`);
  }
  return value;
}

export function timeZone(request: Request): string {
  const zone = new URL(request.url).searchParams.get("timezone_name") || "UTC";
  try {
    if (zone.length > 100) throw new RangeError();
    new Intl.DateTimeFormat("en", { timeZone: zone });
  } catch {
    throw new ApiError(422, "Invalid time zone");
  }
  return zone;
}
