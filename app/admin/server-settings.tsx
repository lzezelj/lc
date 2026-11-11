"use client";
import { useEffect, useState } from "react";
import { ProfilePictureSettings } from "../profile-picture-settings";
import {
  AdminList,
  adminRequest,
  type AdminRow,
  type PendingAction,
} from "./dashboard";

type Confirm = (action: PendingAction) => void;
export function createAdminServer(
  confirm: Confirm,
  created: (row: AdminRow) => void,
) {
  let name = "",
    createAfk = false;
  confirm({
    title: "Create server",
    description:
      "You will own this server. It will start with general text and Lounge voice channels.",
    fields: (
      <div className="adminForm">
        <label>
          Server name
          <input
            maxLength={60}
            onChange={(event) => {
              name = event.target.value;
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            onChange={(event) => {
              createAfk = event.target.checked;
            }}
          />{" "}
          Also create an AFK group voice channel
        </label>
      </div>
    ),
    run: async () => {
      const server = await adminRequest("/api/admin", "POST", {
        target: "server",
        name,
        createAfk,
      });
      created(server);
    },
  });
}
export function deleteAdminAccount(
  userId: string,
  name: string,
  confirm: Confirm,
  deleted: () => void,
) {
  let text = "",
    deleteMessages = false;
  confirm({
    title: `Delete ${name}`,
    description:
      "This disables sign-in, removes memberships and friendships, disconnects calls, and anonymizes this account as Deleted user. Transfer or delete owned servers first. Incoming messages written by others are preserved. A still-allowlisted person can sign up again.",
    fields: (
      <div className="adminForm">
        <label>
          Type DELETE
          <input
            autoComplete="off"
            onChange={(event) => {
              text = event.target.value;
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            onChange={(event) => {
              deleteMessages = event.target.checked;
            }}
          />{" "}
          Permanently erase messages sent by this account, including DMs
        </label>
      </div>
    ),
    run: async () => {
      await adminRequest("/api/admin", "DELETE", {
        target: "user",
        id: userId,
        confirm: text,
        deleteMessages,
      });
      deleted();
    },
  });
}
export function ServerSettings({
  serverId,
  revision,
  confirm,
  refresh,
  onNameChanged,
  onDeleted,
}: {
  serverId: string;
  revision: number;
  confirm: Confirm;
  refresh: () => void;
  onNameChanged: (name: string) => void;
  onDeleted: () => void;
}) {
  const [server, setServer] = useState<AdminRow | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/admin?resource=server&serverId=${serverId}`, {
      signal: abort.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error ?? "Server could not be loaded.");
        if (!abort.signal.aborted) {
          setServer(data.rows[0] ?? null);
          setError(data.rows.length ? "" : "Server not found.");
        }
      })
      .catch((failure) => {
        if (!abort.signal.aborted) {
          setServer(null);
          setError(failure.message);
        }
      });
    return () => abort.abort();
  }, [serverId, revision]);
  if (error) return <p role="alert">{error}</p>;
  if (!server) return <p role="status">Loading server settings…</p>;
  return (
    <section className="adminServerSettings">
      <h3>Server settings</h3>
      <p>
        {server.memberCount} members · {server.channelCount} channels
      </p>
      <p>Owner ID: {server.ownerId}</p>
      <ProfilePictureSettings
        kind="server"
        name={server.name}
        image={
          server.image
            ? `/api/admin/server-picture?serverId=${serverId}&v=${encodeURIComponent(server.image)}`
            : null
        }
        endpoint={`/api/admin/server-picture?serverId=${serverId}`}
        requestHeaders={{ "X-Admin-Confirmed": "true" }}
        confirmChange={(run, remove) =>
          confirm({
            title: remove ? "Remove server picture" : "Change server picture",
            description: `${remove ? "Remove" : "Save the selected picture for"} ${server.name}?`,
            run,
          })
        }
        onSaved={async () => {
          refresh();
        }}
      />
      <div className="adminToolbar">
        <button
          type="button"
          onClick={() => {
            let name = server.name;
            confirm({
              title: "Rename server",
              description: `Change the name of ${server.name}.`,
              fields: (
                <label className="adminForm">
                  Server name
                  <input
                    maxLength={60}
                    defaultValue={name}
                    onChange={(event) => {
                      name = event.target.value;
                    }}
                  />
                </label>
              ),
              run: async () => {
                const saved = await adminRequest("/api/admin", "PATCH", {
                  target: "server",
                  id: serverId,
                  name,
                });
                onNameChanged(saved.name);
                refresh();
              },
            });
          }}
        >
          Rename server
        </button>
        <button
          type="button"
          onClick={() => {
            let settings: {
              afkChannelId?: string | null;
              createAfk?: boolean;
            } = { afkChannelId: server.afkChannelId ?? null };
            confirm({
              title: "AFK settings",
              description:
                "After fifteen minutes of inactivity, connected users can move to the selected group voice channel. Disabling AFK keeps the channel itself.",
              fields: (
                <AfkPicker
                  serverId={serverId}
                  selected={server.afkChannelId ?? null}
                  revision={revision}
                  onChange={(value) => {
                    settings = value;
                  }}
                />
              ),
              run: async () => {
                await adminRequest("/api/admin", "PATCH", {
                  target: "server",
                  id: serverId,
                  action: "afk",
                  ...settings,
                });
                refresh();
              },
            });
          }}
        >
          AFK settings
        </button>
        <button
          type="button"
          onClick={() => {
            let ownerId = "";
            confirm({
              title: "Transfer server ownership",
              description:
                "Choose an active, non-demo member. The former owner stays a member. The recipient’s three-server limit still applies; the configured application owner is exempt.",
              fields: (
                <AdminList
                  resource="members"
                  filters={{ serverId }}
                  label="Search server members"
                  revision={revision}
                  render={(row) => {
                    const unavailable =
                      row.id === server.ownerId ||
                      row.accountRole === "demo" ||
                      !!row.disabledAt ||
                      !!(
                        row.expiresAt && new Date(row.expiresAt) <= new Date()
                      );
                    return (
                      <label className="adminChoice">
                        <input
                          type="radio"
                          name="newServerOwner"
                          disabled={unavailable}
                          onChange={() => {
                            ownerId = row.id;
                          }}
                        />
                        {row.name}
                        {unavailable ? " · ineligible or current owner" : ""}
                      </label>
                    );
                  }}
                />
              ),
              run: async () => {
                await adminRequest("/api/admin", "PATCH", {
                  target: "server",
                  id: serverId,
                  action: "ownership",
                  ownerId,
                });
                refresh();
              },
            });
          }}
        >
          Transfer ownership
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => {
            let text = "";
            confirm({
              title: `Delete ${server.name}`,
              description: `Permanently delete this server, its channels, message history, pictures and sounds? Active calls in its channels will end. ${server.finalDemoCount ?? 0} demo account(s) losing their final server will have access revoked. This cannot be undone.`,
              fields: (
                <label className="adminForm">
                  Type DELETE
                  <input
                    autoComplete="off"
                    onChange={(event) => {
                      text = event.target.value;
                    }}
                  />
                </label>
              ),
              run: async () => {
                await adminRequest("/api/admin", "DELETE", {
                  target: "server",
                  id: serverId,
                  confirm: text,
                });
                onDeleted();
              },
            });
          }}
        >
          Delete server
        </button>
      </div>
    </section>
  );
}
function AfkPicker({
  serverId,
  selected,
  revision,
  onChange,
}: {
  serverId: string;
  selected: string | null;
  revision: number;
  onChange: (value: {
    afkChannelId?: string | null;
    createAfk?: boolean;
  }) => void;
}) {
  const [mode, setMode] = useState(selected ?? "disabled");
  const choose = (value: string) => {
    setMode(value);
    onChange(
      value === "create"
        ? { createAfk: true }
        : { afkChannelId: value === "disabled" ? null : value },
    );
  };
  return (
    <>
      <label className="adminChoice">
        <input
          type="radio"
          name="afkChannel"
          checked={mode === "disabled"}
          onChange={() => choose("disabled")}
        />
        Disable AFK
      </label>
      <label className="adminChoice">
        <input
          type="radio"
          name="afkChannel"
          checked={mode === "create"}
          onChange={() => choose("create")}
        />
        Create an AFK group voice channel
      </label>
      <AdminList
        resource="channels"
        filters={{ serverId, type: "voice_group" }}
        label="Search group voice channels"
        revision={revision}
        render={(row) => (
          <label className="adminChoice">
            <input
              type="radio"
              name="afkChannel"
              checked={mode === row.id}
              onChange={() => choose(row.id)}
            />
            {row.name}
          </label>
        )}
      />
    </>
  );
}
