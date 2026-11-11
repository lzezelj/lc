export function matchesOwnerEmail(email, configuredEmail) {
  return (
    typeof email === "string" &&
    typeof configuredEmail === "string" &&
    configuredEmail.trim().length > 0 &&
    email.trim().toLowerCase() === configuredEmail.trim().toLowerCase()
  );
}

export function currentAccountRole(account, configuredEmail) {
  if (account.role === "demo") return "demo";
  return matchesOwnerEmail(account.email, configuredEmail) ? "owner" : "member";
}
