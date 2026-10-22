export function isAccountActive(account, now = new Date()) {
  return Boolean(
    account &&
    !account.disabledAt &&
    (!account.expiresAt || account.expiresAt > now),
  );
}
