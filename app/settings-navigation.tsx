"use client";

export function SettingsNavigation({
  account,
  selected,
  onSelect,
  owner = false,
}: {
  account: boolean;
  selected: string;
  onSelect: (section: string) => void;
  owner?: boolean;
}) {
  const groups = account
    ? [
        { label: "Account", items: [["account", "My account"]] },
        {
          label: "Communication",
          items: [
            ["media", "Voice & video"],
            ["notifications", "Notifications"],
          ],
        },
        {
          label: "Privacy",
          items: [
            ["messages", "My messages"],
            ["delete-account", "Delete account"],
          ],
        },
        ...(owner
          ? [{ label: "Administration", items: [["demos", "Demo accounts"]] }]
          : []),
        { label: "Session", items: [["logout", "Log out"]] },
      ]
    : [
        {
          label: "Server",
          items: [
            ["overview", "Overview"],
            ["channels", "Channels"],
            ["soundboard", "Soundboard"],
          ],
        },
        { label: "People", items: [["members", "Members"]] },
        {
          label: "Invitations",
          items: [
            ["invite-friends", "Invite friends"],
            ["invite-people", "Invite people"],
          ],
        },
        { label: "Administration", items: [["delete", "Delete server"]] },
      ];
  return (
    <>
      {groups.map((group) => (
        <section
          className="settingsNavGroup"
          aria-label={group.label}
          key={group.label}
        >
          <h3 className="settingsNavCategory">{group.label}</h3>
          {group.items.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`${id.startsWith("delete") || id === "logout" ? "danger" : ""} ${id === selected ? "active" : ""}`}
              aria-current={id === selected ? "page" : undefined}
              onClick={() => onSelect(id)}
            >
              {label}
            </button>
          ))}
        </section>
      ))}
    </>
  );
}
