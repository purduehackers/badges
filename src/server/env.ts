// Read credentials only in server modules. Public package exports never import this file.
export const env = process.env;
export function ingressSecret(): string {
  const secret = env.BADGES_API_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("BADGES_API_SECRET must contain at least 32 characters.");
  return secret;
}
