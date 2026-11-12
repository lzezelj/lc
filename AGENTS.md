# LC project instructions

LC is a private Discord-inspired portfolio project built with Next.js, PostgreSQL, Drizzle, WebRTC, LiveKit, and an authenticated WebSocket signaling service.

## Working style

- Explain what you are changing and why, especially WebRTC, LiveKit, signaling, authentication, database, and deployment decisions.
- When an implementation request leaves architectural questions unresolved, ask the user and wait for their answers before making the dependent architectural decisions. Investigate existing code and documentation first; continue independent work while waiting.
- Preserve existing functionality and unrelated user changes.
- Use `apply_patch` for manual file edits.
- After editing code, run `npm.cmd run format`.
- Run relevant tests and `npm.cmd run build` for substantial changes.
- Mention when new behavior deserves automated tests.
- Update the owning document in `docs/architecture/` whenever architecture, infrastructure, authentication, data flow, or major limitations change. Update `ARCHITECTURE.md` when the topology, shared component responsibilities, or reading map changes.
- Do not create `.env` or `.env.example` files unless explicitly requested.
- Never display, copy, or commit secrets.
- Do not deploy or change production infrastructure unless explicitly requested.
- All buttons must inherit the shared hover animation in `app/globals.css`, including future buttons. Avoid separate hover movement/scaling rules; retain disabled states and reduced-motion support.
- Reuse shared UI components and styles for equivalent controls. Microphone, output, and camera selectors must use `DeviceSelection`; update its shared CSS instead of styling each device selector separately.
- All new visible features and controls, including buttons, dropdown menus, search bars, panels and dialogs, must follow the website's existing visual style. Reuse shared components, CSS variables, typography, spacing, colors, borders, focus states and interaction patterns; extend the shared styles when an equivalent control needs a change.
- Debounce searches that trigger API requests by 500 ms after the last input change using the shared helpers in `app/use-search-debounce.ts`. Keep searches over already-loaded data (including emojis, members, channels and sounds) immediate. Keep typing responsive, cancel obsolete timers/requests, and ignore stale API responses. Explicit Search/Enter submission and pagination remain immediate; preserve existing minimum query lengths and backend authorization/rate limits.

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

Read this `AGENTS.md` directly; a summary does not replace applicable project instructions.

Before architectural changes, read the short overview and reading map in
`ARCHITECTURE.md`, then read only the topic documents in `docs/architecture/`
needed for the task. Follow related-topic links when the change crosses a boundary;
do not load every architecture document by default. These topic files are reference
documentation, not additional `AGENTS.md` instruction files.

For substantial feature work, prefer a read-only architecture sub-agent with a fresh
context: give it the task and ask it to read the overview, relevant topic documents
and relevant source files. Its briefing should include relevant constraints,
components and data flows, file/section references, testing requirements, and
uncertainties or conflicting documentation. Keep the briefing concise and do not
include secrets.

The implementing agent may use this briefing instead of reading the topic documents
in full. Read referenced sections directly when details are unclear or consequential,
verify assumptions against current source, and update the owning topic when required.
If sub-agents are unavailable or the task is small, read the relevant topic sections
directly. Keep detailed contracts in their owning topic and link to them from other
documents rather than duplicating them.
