import { handlers } from "../../../../auth";
import {
  checkRateLimit,
  rateLimits,
  requestIp,
} from "../../../../server/rate-limit";
import { NextRequest, NextResponse } from "next/server";

function limited(request: Request) {
  const pathname = new URL(request.url).pathname;
  return (
    pathname.endsWith("/signin/google") ||
    pathname.endsWith("/callback/demo-invite")
  );
}

function rateLimitedResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many login attempts. Please try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

export async function GET(request: NextRequest) {
  if (limited(request)) {
    const result = checkRateLimit(
      `login:${requestIp(request)}`,
      rateLimits.login,
    );
    if (!result.allowed) return rateLimitedResponse(result.retryAfterSeconds);
  }
  return handlers.GET(request);
}

export async function POST(request: NextRequest) {
  if (limited(request)) {
    const result = checkRateLimit(
      `login:${requestIp(request)}`,
      rateLimits.login,
    );
    if (!result.allowed) return rateLimitedResponse(result.retryAfterSeconds);
  }
  return handlers.POST(request);
}
