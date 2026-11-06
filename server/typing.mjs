// Ephemeral, per-connection state. Multiple tabs deduplicate to one visible user.
export class TypingTracker {
  constructor(onChange, now = Date.now, lifetime = 6000) {
    this.onChange = onChange;
    this.now = now;
    this.lifetime = lifetime;
    this.entries = new Map();
  }
  update(connection, context, user, active) {
    const previous = this.entries.get(connection);
    if (previous && previous.context.key !== context.key) {
      if (!active) return;
      this.entries.delete(connection);
      this.emit(previous.context);
    }
    if (!active) {
      if (previous?.context.key === context.key) this.clear(connection);
      return;
    }
    this.entries.set(connection, {
      context,
      user,
      until: this.now() + this.lifetime,
    });
    this.emit(context);
  }
  clear(connection) {
    const previous = this.entries.get(connection);
    if (!previous) return;
    this.entries.delete(connection);
    this.emit(previous.context);
  }
  expire() {
    const changed = new Map();
    for (const [connection, entry] of this.entries)
      if (entry.until <= this.now()) {
        this.entries.delete(connection);
        changed.set(entry.context.key, entry.context);
      }
    for (const context of changed.values()) this.emit(context);
  }
  emit(context) {
    const users = new Map();
    for (const entry of this.entries.values())
      if (entry.context.key === context.key && entry.until > this.now())
        users.set(entry.user.id, entry.user);
    this.onChange(context, [...users.values()]);
  }
}
