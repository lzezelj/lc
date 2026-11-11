"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { AdminList, adminRequest, type PendingAction } from "./dashboard";

type Demo = {
  id: string;
  name: string;
  status: string;
  expiresAt: string | null;
  servers: { id: string; name: string }[];
};
export function DemoManagement({
  revision,
  refresh,
  confirm,
  navigate,
}: {
  revision: number;
  refresh: () => void;
  confirm: (action: PendingAction) => void;
  navigate: (view: string, values?: Record<string, string>) => void;
}) {
  const { data: session } = useSession();
  const [demos, setDemos] = useState<Demo[] | null>(null),
    [error, setError] = useState(""),
    [invite, setInvite] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/demo-accounts", {
      signal: abort.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!abort.signal.aborted) {
          setDemos(data);
          setError("");
        }
      })
      .catch((failure) => {
        if (!abort.signal.aborted) {
          setDemos(null);
          setError(failure.message);
        }
      });
    return () => abort.abort();
  }, [revision]);
  const act = async (method: string, body: Record<string, unknown>) => {
    const data = await adminRequest("/api/demo-accounts", method, body);
    if (data.inviteUrl) setInvite(data.inviteUrl);
    refresh();
  };
  const picker = (
    initial: string[],
    update: (ids: string[]) => void,
    multiple = true,
  ) => {
    const selected = new Set(initial);
    return (
      <AdminList
        resource="servers"
        filters={{ ownerId: session?.user.id ?? "" }}
        label="Search your servers"
        revision={revision}
        render={(row) => (
          <label className="adminIdentity">
            <input
              type={multiple ? "checkbox" : "radio"}
              name="demoServer"
              defaultChecked={selected.has(row.id)}
              onChange={(event) => {
                if (!multiple) selected.clear();
                if (event.target.checked) selected.add(row.id);
                else selected.delete(row.id);
                update([...selected]);
              }}
            />
            {row.name}
          </label>
        )}
      />
    );
  };
  const visible = (demos ?? []).filter((demo) =>
    demo.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <h2>Demo accounts</h2>
      <p>
        Manage demo accounts you created and access to servers you own. Demo
        accounts must retain at least one server.
      </p>
      <button
        type="button"
        onClick={() => {
          let name = "",
            serverId = "";
          confirm({
            title: "Create demo account",
            description:
              "Create a four-hour invitation after choosing a display name and server.",
            fields: (
              <>
                <label className="adminForm">
                  Display name
                  <input
                    maxLength={60}
                    onChange={(event) => {
                      name = event.target.value;
                    }}
                  />
                </label>
                {picker(
                  [],
                  (ids) => {
                    serverId = ids[0] ?? "";
                  },
                  false,
                )}
              </>
            ),
            run: async () => {
              await act("POST", { name, serverId });
            },
          });
        }}
      >
        Create demo account
      </button>
      {invite && (
        <div className="adminDemoInvite">
          <strong>New invitation</strong>
          <p>Only share this link with the intended recipient.</p>
          <a href={invite} target="_blank" rel="noopener noreferrer">
            {invite}
          </a>
          <button type="button" onClick={() => setInvite("")}>
            Dismiss
          </button>
        </div>
      )}
      <label className="adminSearch">
        Search demo accounts
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {!demos && !error && <p role="status">Loading…</p>}
      <div className="adminRows">
        {visible.slice(page * 25, page * 25 + 25).map((demo) => (
          <article key={demo.id} className="adminMessage">
            <h3>{demo.name}</h3>
            <p>
              {demo.status} ·{" "}
              {demo.expiresAt
                ? new Date(demo.expiresAt).toLocaleString()
                : "No expiry"}
            </p>
            <p>
              {demo.servers.map((server) => server.name).join(", ") ||
                "No current server access"}
            </p>
            <div className="adminToolbar">
              <button
                type="button"
                onClick={() =>
                  navigate("user", { userId: demo.id, userName: demo.name })
                }
              >
                Go to user
              </button>
              <button
                type="button"
                onClick={() => {
                  let ids = demo.servers.map((server) => server.id);
                  confirm({
                    title: "Change demo server access",
                    description: `Replace server access for ${demo.name}. Active connections will be disconnected.`,
                    fields: picker(ids, (selected) => {
                      ids = selected;
                    }),
                    run: async () => {
                      await act("PATCH", {
                        demoUserId: demo.id,
                        action: "servers",
                        serverIds: ids,
                      });
                    },
                  });
                }}
              >
                Server access
              </button>
              <button
                type="button"
                onClick={() => {
                  let name = demo.name;
                  confirm({
                    title: "Rename demo account",
                    description: `Change the display name of ${demo.name}.`,
                    fields: (
                      <label className="adminForm">
                        Display name
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
                      await act("PATCH", {
                        demoUserId: demo.id,
                        action: "rename",
                        name,
                      });
                    },
                  });
                }}
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => {
                  let hours = 4;
                  confirm({
                    title: "Extend demo access",
                    description: `Extend ${demo.name} from its existing expiry.`,
                    fields: (
                      <label className="adminForm">
                        Hours (1–720)
                        <input
                          type="number"
                          min={1}
                          max={720}
                          defaultValue={4}
                          onChange={(event) => {
                            hours = Number(event.target.value);
                          }}
                        />
                      </label>
                    ),
                    run: async () => {
                      await act("PATCH", {
                        demoUserId: demo.id,
                        action: "extend",
                        extensionHours: hours,
                      });
                    },
                  });
                }}
              >
                Extend
              </button>
              <button
                type="button"
                onClick={() => {
                  let serverIds = demo.servers.map((server) => server.id);
                  confirm({
                    title: "Generate new invitation",
                    description: `Replace the invitation for ${demo.name}, confirm server access and reactivate it for four hours. Active connections will be disconnected.`,
                    fields: picker(serverIds, (ids) => {
                      serverIds = ids;
                    }),
                    run: async () => {
                      await act("PATCH", {
                        demoUserId: demo.id,
                        action: "regenerate",
                        serverIds,
                      });
                    },
                  });
                }}
              >
                New invitation
              </button>
              <button
                type="button"
                className="danger"
                onClick={() =>
                  confirm({
                    title: "Revoke demo account",
                    description: `Disable ${demo.name}, remove memberships and disconnect active calls?`,
                    run: async () => {
                      await act("PATCH", {
                        demoUserId: demo.id,
                        action: "revoke",
                      });
                    },
                  })
                }
              >
                Revoke
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  let deleteMessages = false;
                  confirm({
                    title: "Delete demo account",
                    description: `Delete ${demo.name}? Retained messages will be attributed to Deleted user.`,
                    fields: (
                      <label>
                        <input
                          type="checkbox"
                          onChange={(event) => {
                            deleteMessages = event.target.checked;
                          }}
                        />{" "}
                        Permanently delete messages sent by this account too
                      </label>
                    ),
                    run: async () => {
                      await act("DELETE", {
                        demoUserId: demo.id,
                        deleteMessages,
                      });
                    },
                  });
                }}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
      {demos && !visible.length && <p>No matching demo accounts.</p>}
      <div className="adminPagination">
        <button
          type="button"
          disabled={!page}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        <span>Page {page + 1}</span>
        <button
          type="button"
          disabled={(page + 1) * 25 >= visible.length}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </>
  );
}
