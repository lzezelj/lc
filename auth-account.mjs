export const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

export function isSessionWithinLifetime(issuedAt, now = new Date()) {
  return (
    typeof issuedAt === "number" &&
    Number.isFinite(issuedAt) &&
    issuedAt + SESSION_MAX_AGE_SECONDS > Math.floor(now.getTime() / 1000)
  );
}

export function isAccountActive(account, now = new Date()) {
  return Boolean(
    account &&
    !account.disabledAt &&
    (!account.expiresAt || account.expiresAt > now),
  );
}
