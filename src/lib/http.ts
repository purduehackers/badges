import { z } from "zod";

export class BadgeApiError extends Error {
  constructor(
    message: string,
    readonly url?: string,
  ) {
    super(message);
  }
}

/** Validate responses at the transport boundary, including service failures. */
export async function readResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const result: unknown = await response.json();
  if (!response.ok) {
    const problem = z.object({ error: z.string(), url: z.url().optional() }).safeParse(result).data;
    throw new BadgeApiError(
      problem?.error ?? `Badge service failed (${response.status}).`,
      problem?.url,
    );
  }
  return schema.parse(result);
}
