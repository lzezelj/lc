export async function notifyServer(serverId: string) {
  const url = process.env.SIGNALING_INTERNAL_URL ?? "http://127.0.0.1:3001";
  const secret =
    process.env.SIGNALING_INTERNAL_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) return;
  try {
    await fetch(`${url}/internal/server-updated`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ serverId }),
    });
  } catch {
    // Clients recover authoritative names on their next refresh.
  }
}
