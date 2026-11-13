import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const directory = await mkdtemp(join(tmpdir(), "lc-server-rail-"));
try {
  const css = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  const file = join(directory, "rail.html");
  await writeFile(
    file,
    `<!doctype html><style>${css}</style><div class="workspace"><aside class="workspaceRail"><button class="workspaceLogo">LC</button><nav class="serverScroller">${Array.from({ length: 2 }, (_, i) => `<div class="serverButtonWrap"><button class="workspaceButton ${i === 0 ? "active" : ""}"><span class="userAvatar serverPicture avatarWithPlaceholder avatarImageReady"><span class="avatarInitial">${i}</span><img src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27256%27 height=%27256%27%3E%3Crect width=%27256%27 height=%27256%27 fill=%27red%27/%3E%3C/svg%3E"></span></button><span class="serverTooltip">Server ${i}</span></div>`).join("")}</nav><div class="serverButtonWrap addServerButton"><button class="workspaceButton">+</button></div></aside></div><pre id="result"></pre><script>
  const rail = document.querySelector('.serverScroller');
  if (innerWidth <= 650) document.querySelector('.workspace').classList.add('serverListToggled');
  function measure() {
    const host = document.querySelector('.workspaceRail');
    const outer = host.getBoundingClientRect();
    return { height: host.clientHeight, scroll: host.scrollHeight, listHeight: rail.clientHeight, listScroll: rail.scrollHeight, centers: [...rail.querySelectorAll('button')].map(button => { const box = button.getBoundingClientRect(); return Math.abs(box.left + box.width / 2 - outer.left - outer.width / 2); }) };
  }
  const normal = measure();
  rail.append(rail.firstElementChild.cloneNode(true));
  const three = measure();
  for (let i = 0; i < 20; i++) rail.append(rail.firstElementChild.cloneNode(true));
  const host = document.querySelector('.workspaceRail');
  const crowded = measure();
  host.scrollTop = host.scrollHeight;
  const bounds = host.getBoundingClientRect();
  const last = rail.lastElementChild.querySelector('button').getBoundingClientRect();
  const add = document.querySelector('.addServerButton').getBoundingClientRect();
  const result = { viewport: [innerWidth, innerHeight], normal, three, scrollbar: getComputedStyle(host).scrollbarWidth, crowded, bottomClearance: bounds.bottom - last.bottom, addVisible: add.top >= bounds.top && add.bottom <= bounds.bottom, lastVisible: last.top >= bounds.top };
  document.querySelector('#result').textContent = JSON.stringify(result);
  </script>`,
  );
  for (const size of ["1000,900", "1000,420", "400,420", "1000,350"]) {
    const browser = spawnSync(
      process.env.LC_TEST_BROWSER ??
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      [
        "--headless",
        "--disable-gpu",
        "--no-first-run",
        "--dump-dom",
        `--window-size=${size}`,
        `--user-data-dir=${join(directory, `profile-${size}`)}`,
        pathToFileURL(file).href,
      ],
      { encoding: "utf8", timeout: 30000, windowsHide: true },
    );
    if (browser.error) throw browser.error;
    const match = browser.stdout.match(/<pre id="result">([^<]+)<\/pre>/);
    assert.ok(match, browser.stderr.slice(-500));
    const dimensions = JSON.parse(match[1]);
    console.log(dimensions);
    // The approved 8px margin above Create server makes the two-server
    // layout 306px high. Smaller viewports must scroll rather than clip.
    if (dimensions.viewport[1] >= 306)
      assert.ok(
        dimensions.normal.scroll <= dimensions.normal.height,
        `Two server icons must fit at ${dimensions.viewport}`,
      );
    else
      assert.ok(
        dimensions.normal.scroll > dimensions.normal.height,
        "Very short rails retain scrolling",
      );
    assert.ok(
      dimensions.crowded.scroll > dimensions.crowded.height,
      "Long server lists must remain scrollable",
    );
    assert.equal(
      dimensions.scrollbar,
      "thin",
      "The rail must retain a visible scrollbar when needed",
    );
    assert.ok(
      dimensions.three.listScroll <= dimensions.three.listHeight,
      "The inner server list must never clip its icons",
    );
    assert.ok(
      dimensions.lastVisible &&
        dimensions.bottomClearance >= 4 &&
        dimensions.addVisible,
      "Scrolling to the end must reveal the final icon outline and Create server",
    );
    if (dimensions.viewport[1] > 400)
      assert.ok(
        dimensions.three.scroll <= dimensions.three.height,
        "Three servers must fit at normal height",
      );
    assert.ok(
      [
        ...dimensions.normal.centers,
        ...dimensions.three.centers,
        ...dimensions.crowded.centers,
      ].every((delta) => delta < 1),
      "Server icons must stay centered with and without overflow",
    );
  }
} finally {
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  await rm(directory, { recursive: true, force: true });
}
