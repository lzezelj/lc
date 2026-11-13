"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useDebouncedSearch } from "../use-search-debounce";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Avatar } from "../avatar";
import { SettingsModal } from "../settings-modal";
import { DemoManagement } from "./demos";
import {
  ServerSettings,
  createAdminServer,
  deleteAdminAccount,
} from "./server-settings";
import type { MessageAttachment } from "../attachment-types";
import "./admin.css";

export type AdminRow = {
  id: string;
  name: string;
  handle?: string;
  image?: string | null;
  role?: string;
  accountRole?: string;
  ownerId?: string;
  afkChannelId?: string | null;
  soundboardCooldownEnabled?: boolean;
  memberCount?: number;
  channelCount?: number;
  finalDemoCount?: number;
  status?: string;
  createdAt?: string;
  expiresAt?: string | null;
  disabledAt?: string | null;
  isMember?: boolean;
  type?: string;
  text?: string;
  author?: string;
  authorId?: string;
  scope?: string;
  kind?: string;
  serverId?: string;
  serverName?: string;
  channelId?: string;
  channelName?: string;
  peerId?: string;
  peerName?: string;
  editedAt?: string | null;
  editedByAdmin?: boolean;
  deletedAt?: string | null;
  attachments?: MessageAttachment[];
  replyToId?: string | null;
  replyText?: string | null;
  action?: string;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  userId?: string;
};
type Navigate = (view: string, values?: Record<string, string>) => void;
export type PendingAction = {
  title: string;
  description: string;
  run: () => Promise<void>;
  fields?: ReactNode;
};
export async function adminRequest(
  url: string,
  method: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, confirmed: true }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? "The change could not be saved.");
  return data;
}
const date = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "—";
export function AdminDashboard() {
  const query = useSearchParams(),
    router = useRouter(),
    { status, data: session } = useSession();
  const [revision, setRevision] = useState(0),
    [pending, setPending] = useState<PendingAction | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const view = query.get("view") ?? "users",
    userId = query.get("userId") ?? "",
    serverId = query.get("serverId") ?? "",
    channelId = query.get("channelId") ?? "";
  const userName = query.get("userName") ?? "User",
    serverName = query.get("serverName") ?? "Server",
    channelName = query.get("channelName") ?? "Channel";
  const navigate: Navigate = (next, values = {}) =>
    router.push(`/admin?${new URLSearchParams({ view: next, ...values })}`);
  const userValues = { userId, userName },
    serverValues = { serverId, serverName };
  const confirm = (action: PendingAction) => {
    setError("");
    setPending(action);
  };
  const refresh = () => setRevision((value) => value + 1);
  // Also clear already-loaded private data when polling detects revoked access.
  if (
    status === "unauthenticated" ||
    (session && session.user.role !== "owner")
  )
    return (
      <main className="adminDenied">
        <h1>Access denied</h1>
        <Link href="/">Return to LC</Link>
      </main>
    );
  const userLink = (row: AdminRow) =>
    navigate("user", { userId: row.id, userName: row.name });
  const serverLink = (row: AdminRow) =>
    navigate("server", { serverId: row.id, serverName: row.name });
  const messages = (filters: Record<string, string>, label: string) => (
    <AdminList
      resource="messages"
      filters={filters}
      label={label}
      revision={revision}
      render={(row) => (
        <MessageRow
          row={row}
          navigate={navigate}
          confirm={confirm}
          refresh={refresh}
        />
      )}
    />
  );
  return (
    <main className="adminShell">
      <header className="adminHeader">
        <a
          className="adminBrand"
          href="/"
          target="_blank"
          rel="noopener noreferrer"
        >
          LC
        </a>
        <div>
          <h1>Administration</h1>
          <p>Users, servers and moderation</p>
        </div>
        <button type="button" onClick={refresh}>
          Refresh
        </button>
      </header>
      <nav className="adminTabs" aria-label="Admin sections">
        {[
          ["users", "Users"],
          ["servers", "Servers"],
          ["demos", "Demo accounts"],
          ["audit", "Admin log"],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-current={view === id ? "page" : undefined}
            className={view === id ? "active" : ""}
            onClick={() => navigate(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div
        className="adminContent"
        key={`${view}:${userId}:${serverId}:${channelId}`}
      >
        {view === "users" && (
          <>
            <h2>All users</h2>
            <AdminList
              resource="users"
              label="Search all users"
              revision={revision}
              render={(row) => (
                <Identity row={row} onClick={() => userLink(row)} />
              )}
            />
          </>
        )}
        {view === "servers" && (
          <>
            <Context
              title="All servers"
              actions={
                <button
                  type="button"
                  onClick={() => createAdminServer(confirm, serverLink)}
                >
                  Create server
                </button>
              }
            />
            <AdminList
              resource="servers"
              label="Search all servers"
              revision={revision}
              render={(row) => (
                <button
                  className="adminListButton"
                  type="button"
                  onClick={() => serverLink(row)}
                >
                  {row.name}
                </button>
              )}
            />
          </>
        )}
        {view === "user" && (
          <>
            <Profile userId={userId} revision={revision} />
            <div className="adminToolbar">
              <button
                type="button"
                className="danger"
                disabled={userId === session?.user.id}
                onClick={() =>
                  deleteAdminAccount(userId, userName, confirm, () =>
                    navigate("users"),
                  )
                }
              >
                Delete user
              </button>
            </div>
            <div className="adminTabs">
              <button
                type="button"
                onClick={() => navigate("user-messages", userValues)}
              >
                Search all server messages
              </button>
              <button
                type="button"
                onClick={() => navigate("direct", userValues)}
              >
                Direct messages
              </button>
            </div>
            <h3>Servers and retained message history</h3>
            <AdminList
              resource="servers"
              filters={{ userId }}
              label="Search this user’s servers"
              revision={revision}
              render={(row) => (
                <button
                  className="adminListButton"
                  type="button"
                  onClick={() =>
                    navigate("user-server", {
                      ...userValues,
                      serverId: row.id,
                      serverName: row.name,
                    })
                  }
                >
                  {row.name}
                  <small>
                    {row.isMember
                      ? "Current member"
                      : "Former member · messages remain"}
                  </small>
                </button>
              )}
            />
          </>
        )}
        {view === "user-messages" && (
          <>
            <Context
              title={`${userName} · All server messages`}
              actions={
                <button
                  type="button"
                  onClick={() => navigate("user", userValues)}
                >
                  Go to user
                </button>
              }
            />
            {messages(
              { userId, scope: "server" },
              "Search this user’s messages across all servers",
            )}
          </>
        )}
        {view === "direct" && (
          <>
            <Context
              title={`${userName} · Direct messages sent`}
              actions={
                <button
                  type="button"
                  onClick={() => navigate("user", userValues)}
                >
                  Go to user
                </button>
              }
            />
            <p>
              Messages sent by this user, separated from server channels. Select
              a recipient or search all recipients.
            </p>
            <AdminList
              resource="conversations"
              filters={{ userId }}
              label="Search recipients"
              revision={revision}
              render={(row) => (
                <Identity
                  row={row}
                  onClick={() =>
                    navigate("direct", {
                      ...userValues,
                      peerId: row.id,
                      peerName: row.name,
                    })
                  }
                />
              )}
            />
            {query.get("peerId") && (
              <div className="adminToolbar">
                <strong>To {query.get("peerName")}</strong>
                <button
                  type="button"
                  onClick={() => navigate("direct", userValues)}
                >
                  All recipients
                </button>
              </div>
            )}
            {messages(
              {
                userId,
                scope: "direct",
                ...(query.get("peerId")
                  ? { peerId: query.get("peerId")! }
                  : {}),
              },
              "Search this user’s direct messages",
            )}
          </>
        )}
        {view === "server" && (
          <>
            <Context
              title={serverName}
              actions={
                <button
                  type="button"
                  onClick={() => confirm(channelCreate(serverId, refresh))}
                >
                  Create channel
                </button>
              }
            />
            <ServerSettings
              serverId={serverId}
              revision={revision}
              confirm={confirm}
              refresh={refresh}
              onNameChanged={(name) => {
                const params = new URLSearchParams(query.toString());
                params.set("serverName", name);
                router.replace(`/admin?${params}`, { scroll: false });
              }}
              onDeleted={() => navigate("servers")}
            />
            <div className="adminColumns">
              <section>
                <h3>Members</h3>
                <AdminList
                  resource="members"
                  filters={{ serverId }}
                  label="Search server members"
                  revision={revision}
                  render={(row) => (
                    <Identity
                      row={row}
                      onClick={() =>
                        navigate("user-server", {
                          ...serverValues,
                          userId: row.id,
                          userName: row.name,
                        })
                      }
                    />
                  )}
                />
              </section>
              <section>
                <h3>Channels</h3>
                <AdminList
                  resource="channels"
                  filters={{ serverId }}
                  label="Search server channels"
                  revision={revision}
                  render={(row) => (
                    <div className="adminChannel">
                      <button
                        className="adminListButton"
                        type="button"
                        onClick={() =>
                          navigate("channel", {
                            ...serverValues,
                            channelId: row.id,
                            channelName: row.name,
                            channelType: row.type ?? "text",
                          })
                        }
                      >
                        {row.name}
                        <small>{channelType(row.type)}</small>
                      </button>
                      <ChannelActions
                        row={row}
                        serverId={serverId}
                        confirm={confirm}
                        refresh={refresh}
                      />
                    </div>
                  )}
                />
              </section>
            </div>
            <h3>All text-channel messages</h3>
            {messages(
              { serverId, scope: "server" },
              "Search messages in this server",
            )}
          </>
        )}
        {view === "user-server" && (
          <>
            <Context
              title={`${userName} · ${serverName}`}
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => navigate("user", userValues)}
                  >
                    Go to user
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("server", serverValues)}
                  >
                    Go to server
                  </button>
                </>
              }
            />
            <h3>Channels with messages from this user</h3>
            <AdminList
              resource="channels"
              filters={{ userId, serverId }}
              label="Search this user’s channels"
              revision={revision}
              render={(row) => (
                <button
                  className="adminListButton"
                  type="button"
                  onClick={() =>
                    navigate("channel", {
                      ...userValues,
                      ...serverValues,
                      channelId: row.id,
                      channelName: row.name,
                      channelType: row.type ?? "text",
                    })
                  }
                >
                  {row.name}
                </button>
              )}
            />
            {messages(
              { userId, serverId, scope: "server" },
              "Search this user’s messages in this server",
            )}
          </>
        )}
        {view === "channel" && (
          <>
            <Context
              title={`${serverName} / ${channelName}${userId ? ` · ${userName}` : ""}`}
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => navigate("server", serverValues)}
                  >
                    Go to server
                  </button>
                  {userId && (
                    <button
                      type="button"
                      onClick={() => navigate("user", userValues)}
                    >
                      Go to user
                    </button>
                  )}
                </>
              }
            />
            <ChannelActions
              row={{
                id: channelId,
                name: channelName,
                type: query.get("channelType") ?? "text",
              }}
              serverId={serverId}
              confirm={confirm}
              refresh={() => {
                refresh();
              }}
              onDeleted={() => navigate("server", serverValues)}
              onRenamed={(name) => {
                const params = new URLSearchParams(query.toString());
                params.set("channelName", name);
                router.replace(`/admin?${params}`, { scroll: false });
              }}
            />
            {query.get("channelType")?.startsWith("voice") ? (
              <p>Voice channels have no stored chat messages.</p>
            ) : (
              messages(
                {
                  serverId,
                  channelId,
                  scope: "server",
                  ...(userId ? { userId } : {}),
                },
                userId
                  ? "Search this user’s messages in this channel"
                  : "Search messages in this channel",
              )
            )}
          </>
        )}
        {view === "demos" && (
          <DemoManagement
            revision={revision}
            refresh={refresh}
            confirm={confirm}
            navigate={navigate}
          />
        )}
        {view === "audit" && (
          <>
            <h2>Admin log</h2>
            <p>
              Actions and identifiers are retained. Previous message text is not
              stored.
            </p>
            <AdminList
              resource="audit"
              label="Search actions or target IDs"
              revision={revision}
              render={(row) => (
                <article className="adminAudit">
                  <strong>{row.action}</strong>
                  <time>{date(row.createdAt)}</time>
                  <p>Admin: {row.actorId}</p>
                  <p>
                    {row.targetType}: {row.targetId}
                  </p>
                  {row.userId && (
                    <button
                      type="button"
                      onClick={() =>
                        navigate("user", {
                          userId: row.userId!,
                          userName: "User",
                        })
                      }
                    >
                      Go to user
                    </button>
                  )}
                  {row.serverId && (
                    <button
                      type="button"
                      onClick={() =>
                        navigate("server", {
                          serverId: row.serverId!,
                          serverName: "Server",
                        })
                      }
                    >
                      Go to server
                    </button>
                  )}
                </article>
              )}
            />
          </>
        )}
      </div>
      {pending && (
        <SettingsModal
          title={pending.title}
          onClose={() => {
            if (!busy) setPending(null);
          }}
        >
          <p>{pending.description}</p>
          {pending.fields}
          {error && <p role="alert">{error}</p>}
          <div className="adminToolbar">
            <button
              type="button"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await pending.run();
                  setPending(null);
                  refresh();
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "The change failed.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Saving…" : "Confirm"}
            </button>
          </div>
        </SettingsModal>
      )}
    </main>
  );
}
function Context({ title, actions }: { title: string; actions: ReactNode }) {
  return (
    <header className="adminContext">
      <h2>{title}</h2>
      <div className="adminToolbar">{actions}</div>
    </header>
  );
}
function channelType(type?: string) {
  return type === "voice_direct"
    ? "Direct voice"
    : type === "voice_group"
      ? "Group voice"
      : "Text";
}
export function Identity({
  row,
  onClick,
}: {
  row: AdminRow;
  onClick?: () => void;
}) {
  const image = row.image?.startsWith("/api/users/")
    ? `/api/admin/files?kind=avatar&id=${row.id}`
    : row.image;
  const content = (
    <>
      <Avatar name={row.name} image={image} showPlaceholder />
      <span>
        <strong>{row.name}</strong>
        <small>
          {row.handle} {row.role && `· ${row.role}`}
        </small>
        <small>{row.status ?? ""}</small>
      </span>
    </>
  );
  return onClick ? (
    <button className="adminIdentity" type="button" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="adminIdentity">{content}</div>
  );
}
export function AdminList({
  resource,
  filters = {},
  label,
  revision,
  render,
}: {
  resource: string;
  filters?: Record<string, string>;
  label: string;
  revision: number;
  render: (row: AdminRow) => ReactNode;
}) {
  const search = useSearchParams(),
    router = useRouter(),
    queryKey = `q_${resource}`,
    pageKey = `p_${resource}`;
  const q = search.get(queryKey) ?? "",
    page = Number(search.get(pageKey) ?? 0);
  const [loaded, setData] = useState<{
      endpoint: string;
      rows: AdminRow[];
      nextPage: number | null;
    } | null>(null),
    [error, setError] = useState("");
  const endpoint = `/api/admin?${new URLSearchParams({ ...filters, resource, q, page: String(page) })}`;
  const data = loaded?.endpoint === endpoint ? loaded : null;
  useEffect(() => {
    const abort = new AbortController();
    void fetch(endpoint, { signal: abort.signal, cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error ?? "Could not load records.");
        if (!abort.signal.aborted) {
          setData({ ...result, endpoint });
          setError("");
        }
      })
      .catch((failure) => {
        if (!abort.signal.aborted) {
          setData(null);
          setError(failure.message);
        }
      });
    return () => abort.abort();
  }, [endpoint, revision]);
  const input = useRef<HTMLInputElement>(null);
  const submittedQuery = useRef(q);
  const update = (nextQuery: string, nextPage: number) => {
    submittedQuery.current = nextQuery;
    const params = new URLSearchParams(search.toString());
    params.set(queryKey, nextQuery);
    params.set(pageKey, String(nextPage));
    router.replace(`/admin?${params}`, { scroll: false });
  };
  const { schedule, cancel } = useDebouncedSearch((text: string) => {
    update(text, 0);
  });
  useEffect(() => {
    if (submittedQuery.current !== q) {
      cancel();
      submittedQuery.current = q;
      if (input.current) input.current.value = q;
    }
  }, [q, cancel]);
  const searchScope = JSON.stringify({ resource, filters });
  useEffect(() => cancel, [searchScope, cancel]);
  return (
    <div className="adminList">
      <form
        className="adminSearch"
        onSubmit={(event) => {
          event.preventDefault();
          cancel();
          update(
            String(new FormData(event.currentTarget).get("search") ?? ""),
            0,
          );
        }}
      >
        <label>
          <span>{label}</span>
          <input
            type="search"
            maxLength={200}
            name="search"
            ref={input}
            defaultValue={q}
            onChange={(event) => schedule(event.target.value)}
          />
        </label>
        <button type="submit">Search</button>
      </form>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p role="status">Loading…</p>
      ) : (
        <>
          <div className="adminRows">
            {data.rows.map((row) => (
              <div key={row.id}>{render(row)}</div>
            ))}
            {!data.rows.length && <p>No matching records.</p>}
          </div>
          <div className="adminPagination">
            <button
              type="button"
              disabled={!page}
              onClick={() => {
                update(q, page - 1);
              }}
            >
              Previous
            </button>
            <span>Page {page + 1}</span>
            <button
              type="button"
              disabled={data.nextPage === null}
              onClick={() => {
                update(q, data.nextPage!);
              }}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
function Profile({ userId, revision }: { userId: string; revision: number }) {
  const [profile, setProfile] = useState<AdminRow | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/admin?resource=profile&userId=${userId}`, {
      signal: abort.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!abort.signal.aborted) {
          setProfile(data.rows[0] ?? null);
          setError(data.rows.length ? "" : "User not found.");
        }
      })
      .catch((failure) => {
        if (!abort.signal.aborted) {
          setProfile(null);
          setError(failure.message);
        }
      });
    return () => abort.abort();
  }, [userId, revision]);
  return error ? (
    <p role="alert">{error}</p>
  ) : !profile ? (
    <p>Loading profile…</p>
  ) : (
    <section className="adminProfile">
      <Identity row={profile} />
      <dl>
        <dt>User ID</dt>
        <dd>{profile.id}</dd>
        <dt>Created</dt>
        <dd>{date(profile.createdAt)}</dd>
        <dt>Account</dt>
        <dd>
          {profile.disabledAt
            ? "Disabled"
            : profile.expiresAt && new Date(profile.expiresAt) <= new Date()
              ? "Expired"
              : "Active"}
        </dd>
        {profile.expiresAt && (
          <>
            <dt>Expires</dt>
            <dd>{date(profile.expiresAt)}</dd>
          </>
        )}
      </dl>
    </section>
  );
}
function channelCreate(serverId: string, refresh: () => void): PendingAction {
  let name = "",
    type = "text";
  return {
    title: "Create channel",
    description: "Review the name and channel type, then confirm creation.",
    fields: (
      <div className="adminForm">
        <label>
          Name
          <input
            maxLength={60}
            onChange={(event) => {
              name = event.target.value;
            }}
          />
        </label>
        <label>
          Type
          <select
            onChange={(event) => {
              type = event.target.value;
            }}
          >
            <option value="text">Text</option>
            <option value="voice_direct">Direct voice</option>
            <option value="voice_group">Group voice</option>
          </select>
        </label>
      </div>
    ),
    run: async () => {
      await adminRequest("/api/admin", "POST", {
        target: "channel",
        serverId,
        name,
        type,
      });
      refresh();
    },
  };
}
function ChannelActions({
  row,
  serverId,
  confirm,
  refresh,
  onDeleted,
  onRenamed,
}: {
  row: AdminRow;
  serverId: string;
  confirm: (action: PendingAction) => void;
  refresh: () => void;
  onDeleted?: () => void;
  onRenamed?: (name: string) => void;
}) {
  return (
    <div className="adminToolbar">
      <button
        type="button"
        onClick={() => {
          let name = row.name;
          confirm({
            title: "Rename channel",
            description: `Rename ${row.name}.`,
            fields: (
              <label className="adminForm">
                Name
                <input
                  defaultValue={name}
                  maxLength={60}
                  onChange={(event) => {
                    name = event.target.value;
                  }}
                />
              </label>
            ),
            run: async () => {
              await adminRequest("/api/admin", "PATCH", {
                target: "channel",
                id: row.id,
                serverId,
                name,
              });
              refresh();
              onRenamed?.(name.trim());
            },
          });
        }}
      >
        Rename
      </button>
      <button
        type="button"
        className="danger"
        onClick={() =>
          confirm({
            title: "Delete channel",
            description: `Permanently delete ${row.name} and its message history? Connected participants will be disconnected and notified that an admin deleted the channel.`,
            run: async () => {
              await adminRequest("/api/admin", "DELETE", {
                target: "channel",
                id: row.id,
                serverId,
              });
              refresh();
              onDeleted?.();
            },
          })
        }
      >
        Delete
      </button>
    </div>
  );
}
function MessageRow({
  row,
  navigate,
  confirm,
  refresh,
}: {
  row: AdminRow;
  navigate: Navigate;
  confirm: (action: PendingAction) => void;
  refresh: () => void;
}) {
  const body = { target: "message", id: row.id, scope: row.scope };
  return (
    <article className="adminMessage">
      <header>
        <button
          type="button"
          className="profileLink"
          onClick={() =>
            navigate("user", { userId: row.authorId!, userName: row.author! })
          }
        >
          {row.author}
        </button>
        <time>{date(row.createdAt)}</time>
        {row.editedAt && (
          <small>{row.editedByAdmin ? "Edited by admin" : "Edited"}</small>
        )}
      </header>
      <div className="adminMessageContext">
        {row.scope === "server" ? (
          <>
            <button
              type="button"
              onClick={() =>
                navigate("server", {
                  serverId: row.serverId!,
                  serverName: row.serverName!,
                })
              }
            >
              {row.serverName}
            </button>
            <button
              type="button"
              onClick={() =>
                navigate("channel", {
                  serverId: row.serverId!,
                  serverName: row.serverName!,
                  channelId: row.channelId!,
                  channelName: row.channelName!,
                })
              }
            >
              #{row.channelName}
            </button>
          </>
        ) : (
          <span>Direct message to {row.peerName}</span>
        )}
      </div>
      {row.replyToId && (
        <blockquote>Reply: {row.replyText || "Attachment"}</blockquote>
      )}
      <p className="adminMessageText">
        {row.deletedAt
          ? "Deleted message"
          : row.kind === "call"
            ? "Call record"
            : row.text}
      </p>
      {row.attachments?.map((file) => (
        <div key={file.id}>
          {file.expired ? (
            <span>{file.name} · expired</span>
          ) : (
            <a
              href={`/api/admin/files?id=${file.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {file.name} · {(file.size / 1024).toFixed(1)} KB
            </a>
          )}
        </div>
      ))}
      <div className="adminToolbar">
        {!row.deletedAt && row.kind !== "call" && (
          <button
            type="button"
            onClick={() => {
              let text = row.text ?? "";
              confirm({
                title: "Edit message",
                description:
                  "This preserves the original author and labels the message as edited by admin.",
                fields: (
                  <label className="adminForm">
                    Message
                    <textarea
                      rows={5}
                      maxLength={4000}
                      defaultValue={text}
                      onChange={(event) => {
                        text = event.target.value;
                      }}
                    />
                  </label>
                ),
                run: async () => {
                  await adminRequest("/api/admin", "PATCH", { ...body, text });
                  refresh();
                },
              });
            }}
          >
            Edit
          </button>
        )}
        {!row.deletedAt && (
          <button
            type="button"
            className="danger"
            onClick={() =>
              confirm({
                title: "Delete message",
                description:
                  "Erase this message’s content and attachments, leaving a deleted-message placeholder?",
                run: async () => {
                  await adminRequest("/api/admin", "DELETE", body);
                  refresh();
                },
              })
            }
          >
            Delete
          </button>
        )}
        <button
          type="button"
          className="danger"
          onClick={() =>
            confirm({
              title: "Permanently delete message",
              description:
                "Remove this message permanently? Replies survive without a reference to this message. This cannot be undone.",
              run: async () => {
                await adminRequest("/api/admin", "DELETE", {
                  ...body,
                  permanent: true,
                });
                refresh();
              },
            })
          }
        >
          Permanently delete
        </button>
      </div>
    </article>
  );
}
