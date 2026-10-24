import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type Pane = {
  id: string; // %12
  sessionName: string;
  windowIndex: number;
  windowName: string;
  paneIndex: number;
  command: string;
  path: string;
  title: string;
  pid: number;
  active: boolean; // active pane in its window
  windowActive: boolean; // active window in its session
  sessionAttached: boolean;
  width: number;
  height: number;
};

type Client = { name: string; pid: number; session: string; activity: number };

// Fields are joined with a unit separator, which won't appear in titles or paths.
const SEP = "\x1f";

const PANE_FORMAT = [
  "#{pane_id}",
  "#{session_name}",
  "#{window_index}",
  "#{window_name}",
  "#{pane_index}",
  "#{pane_current_command}",
  "#{pane_current_path}",
  "#{pane_title}",
  "#{pane_pid}",
  "#{pane_active}",
  "#{window_active}",
  "#{session_attached}",
  "#{pane_width}",
  "#{pane_height}",
].join(SEP);

async function tmux(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("tmux", args, { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

export async function listPanes(): Promise<Pane[]> {
  let out: string;
  try {
    out = await tmux("list-panes", "-a", "-F", PANE_FORMAT);
  } catch (e) {
    // "no server running" is an empty state, not an error
    if (String((e as { stderr?: string }).stderr ?? e).includes("no server running")) return [];
    throw e;
  }

  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const f = line.split(SEP);
      return {
        id: f[0],
        sessionName: f[1],
        windowIndex: Number(f[2]),
        windowName: f[3],
        paneIndex: Number(f[4]),
        command: f[5],
        path: f[6],
        title: f[7],
        pid: Number(f[8]),
        active: f[9] === "1",
        windowActive: f[10] === "1",
        sessionAttached: f[11] !== "0",
        width: Number(f[12]),
        height: Number(f[13]),
      };
    });
}

export async function capturePane(paneId: string, lines: number): Promise<string> {
  const out = await tmux("capture-pane", "-p", "-J", "-t", paneId, "-S", `-${lines}`);
  return out.replace(/\s+$/, "");
}

async function listClients(): Promise<Client[]> {
  const out = await tmux(
    "list-clients",
    "-F",
    ["#{client_name}", "#{client_pid}", "#{client_session}", "#{client_activity}"].join(SEP),
  );
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, pid, session, activity] = line.split(SEP);
      return { name, pid: Number(pid), session, activity: Number(activity) };
    });
}

export async function killPane(paneId: string): Promise<void> {
  await tmux("kill-pane", "-t", paneId);
}

/**
 * Make the pane current, point the most recently used client at it and raise
 * that client's terminal window. If no client is attached, open a terminal
 * running `tmux attach`.
 */
export async function switchToPane(pane: Pane, terminalCommand: string): Promise<void> {
  await tmux("select-window", "-t", pane.id);
  await tmux("select-pane", "-t", pane.id);

  const clients = await listClients();
  if (clients.length === 0) {
    const argv = terminalCommand.trim().split(/\s+/).filter(Boolean);
    if (argv.length === 0) throw new Error("No tmux client attached and no terminal command configured");
    const child = spawn(argv[0], [...argv.slice(1), "tmux", "attach-session", "-t", pane.sessionName], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return;
  }

  // Prefer a client already on the pane's session, then the most recently active one.
  const client =
    clients.filter((c) => c.session === pane.sessionName).sort((a, b) => b.activity - a.activity)[0] ??
    clients.sort((a, b) => b.activity - a.activity)[0];

  await tmux("switch-client", "-c", client.name, "-t", pane.id);
  await focusClientWindow(client.pid);
}

function parentPid(pid: number): number | undefined {
  try {
    // /proc/<pid>/stat: "pid (comm) state ppid ..." - comm may contain spaces, so split after the last ')'
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    return ppid > 1 ? ppid : undefined;
  } catch {
    return undefined;
  }
}

/** Best effort: walk up from the tmux client process to the terminal window that hosts it (Hyprland only). */
async function focusClientWindow(clientPid: number): Promise<void> {
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return;

  let windows: { address: string; pid: number; focusHistoryID: number }[];
  try {
    const { stdout } = await execFileAsync("hyprctl", ["clients", "-j"]);
    windows = JSON.parse(stdout);
  } catch {
    return;
  }

  for (let pid: number | undefined = clientPid; pid; pid = parentPid(pid)) {
    // Single-instance terminals (e.g. Ghostty) own several windows under one pid;
    // the most recently focused one is the best guess.
    const match = windows.filter((w) => w.pid === pid).sort((a, b) => a.focusHistoryID - b.focusHistoryID)[0];
    if (match) {
      await execFileAsync("hyprctl", ["dispatch", "focuswindow", `address:${match.address}`]).catch(() => {});
      return;
    }
  }
}
