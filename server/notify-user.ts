export async function notifyUser(
  userId: string,
  event: Record<string, unknown>,
) {
  const signalingUrl =
    process.env.SIGNALING_INTERNAL_URL ?? "http://127.0.0.1:3001";
  const secret =
    process.env.SIGNALING_INTERNAL_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) return;

  try {
    await fetch(`${signalingUrl}/internal/user-event`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId, event }),
    });
  } catch {
    // Durable state is already committed; clients recover it on refresh.
  }
}
