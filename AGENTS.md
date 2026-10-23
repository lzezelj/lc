# LC project instructions

LC is a private Discord-inspired portfolio project built with Next.js, PostgreSQL, Drizzle, WebRTC, LiveKit, and an authenticated WebSocket signaling service.

## Working style

- Explain what you are changing and why, especially WebRTC, LiveKit, signaling, authentication, database, and deployment decisions.
- Preserve existing functionality and unrelated user changes.
- Use `apply_patch` for manual file edits.
- After editing code, run `npm.cmd run format`.
- Run relevant tests and `npm.cmd run build` for substantial changes.
- Mention when new behavior deserves automated tests.
- Update `ARCHITECTURE.md` whenever architecture, infrastructure, authentication, data flow, or major limitations change.
- Do not create `.env` or `.env.example` files unless explicitly requested.
- Never display, copy, or commit secrets.
- Do not deploy or change production infrastructure unless explicitly requested.

## Product rules

- Users receive access at the server level and can access every channel in that server.
- New allowlisted accounts start without server access.
- Demo accounts must have at least one server.
- Voice connections must survive navigation between servers and text channels.
- Camera is off by default when joining voice.
- Legal documents open without unmounting the active application/call.
- PostgreSQL is authoritative for text messages; WebSockets provide real-time delivery.
- Authorization must be enforced by backend APIs, not only hidden UI controls.

## Architecture

Read `ARCHITECTURE.md` before making architectural changes.
