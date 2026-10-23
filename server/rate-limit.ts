type RateLimit = { limit: number; windowMs: number };

type RateLimitEntry = { count: number; resetAt: number };

const entries = new Map<string, RateLimitEntry>();

export const rateLimits = {
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  message: { limit: 10, windowMs: 10 * 1000 },
  serverMutation: { limit: 10, windowMs: 60 * 60 * 1000 },
  adminMutation: { limit: 30, windowMs: 60 * 60 * 1000 },
  signalingToken: { limit: 120, windowMs: 60 * 1000 },
  livekitToken: { limit: 30, windowMs: 60 * 1000 },
} satisfies Record<string, RateLimit>;

export function requestIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export function checkRateLimit(
  key: string,
  policy: RateLimit,
  now = Date.now(),
) {
  const current = entries.get(key);
  if (!current || current.resetAt <= now) {
    entries.set(key, { count: 1, resetAt: now + policy.windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= policy.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetRateLimitsForTests() {
  entries.clear();
}
