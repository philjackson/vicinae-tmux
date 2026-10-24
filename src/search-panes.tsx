import {
  Action,
  ActionPanel,
  Alert,
  Color,
  Icon,
  List,
  Toast,
  closeMainWindow,
  confirmAlert,
  getPreferenceValues,
  showToast,
} from "@vicinae/api";
import { homedir } from "node:os";
import { useCallback, useEffect, useState } from "react";
import { type Pane, capturePane, killPane, listPanes, switchToPane } from "./tmux";

type Preferences = { terminalCommand?: string; previewLines?: string; searchLines?: string };

type Match = {
  pane: Pane;
  target: string;
  // index of the last content line matching the query, if the query hit the content
  contentLine?: number;
};

const HOME = homedir();

function tildify(path: string): string {
  return path.startsWith(HOME) ? `~${path.slice(HOME.length)}` : path;
}

function errorMessage(e: unknown): string {
  return String((e as { stderr?: string }).stderr || (e as Error).message || e).trim();
}

function paneTarget(pane: Pane): string {
  return `${pane.sessionName}:${pane.windowIndex}.${pane.paneIndex}`;
}

/**
 * Every whitespace-separated term must appear (case-insensitively) in the pane's
 * metadata or its captured content. Content matches are located so we can show them.
 */
function matchPane(pane: Pane, lines: string[], terms: string[]): Match | undefined {
  const target = paneTarget(pane);
  if (terms.length === 0) return { pane, target };

  const meta = [pane.sessionName, pane.windowName, pane.command, pane.path, pane.title, target, pane.id]
    .join(" ")
    .toLowerCase();
  const contentTerms = terms.filter((t) => !meta.includes(t));
  if (contentTerms.length === 0) return { pane, target };

  const lower = lines.map((l) => l.toLowerCase());
  if (!contentTerms.every((t) => lower.some((l) => l.includes(t)))) return undefined;

  // Prefer the most recent line containing all content terms, else the most recent containing any.
  let contentLine = lower.findLastIndex((l) => contentTerms.every((t) => l.includes(t)));
  if (contentLine === -1) contentLine = lower.findLastIndex((l) => contentTerms.some((t) => l.includes(t)));
  return { pane, target, contentLine };
}

function previewText(lines: string[], previewLines: number, contentLine?: number): string {
  if (contentLine === undefined) return lines.slice(-previewLines).join("\n");
  const start = Math.max(0, contentLine - Math.floor(previewLines / 2));
  return lines.slice(start, start + previewLines).join("\n");
}

export default function SearchPanes() {
  const prefs = getPreferenceValues<Preferences>();
  const previewLines = Number(prefs.previewLines) || 40;
  const searchLines = Number(prefs.searchLines) || 2000;

  const [panes, setPanes] = useState<Pane[]>();
  const [contents, setContents] = useState<Record<string, string[]>>({});
  const [searchText, setSearchText] = useState("");

  const refresh = useCallback(async () => {
    try {
      const found = await listPanes();
      const captured = await Promise.all(
        found.map((p) =>
          capturePane(p.id, searchLines)
            .then((text) => text.split("\n"))
            .catch((e) => [`Could not capture pane: ${errorMessage(e)}`]),
        ),
      );
      setContents(Object.fromEntries(found.map((p, i) => [p.id, captured[i]])));
      setPanes(found);
    } catch (e) {
      setPanes([]);
      showToast({ style: Toast.Style.Failure, title: "Failed to list tmux panes", message: errorMessage(e) });
    }
  }, [searchLines]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function jump(pane: Pane) {
    try {
      await switchToPane(pane, prefs.terminalCommand ?? "ghostty -e");
      await closeMainWindow();
    } catch (e) {
      showToast({ style: Toast.Style.Failure, title: "Failed to switch pane", message: errorMessage(e) });
    }
  }

  async function kill(pane: Pane) {
    const ok = await confirmAlert({
      title: `Kill pane ${pane.id}?`,
      message: `${pane.command} in ${paneTarget(pane)}`,
      primaryAction: { title: "Kill", style: Alert.ActionStyle.Destructive },
    });
    if (!ok) return;
    try {
      await killPane(pane.id);
      await refresh();
      showToast({ style: Toast.Style.Success, title: "Pane killed" });
    } catch (e) {
      showToast({ style: Toast.Style.Failure, title: "Failed to kill pane", message: errorMessage(e) });
    }
  }

  const terms = searchText.toLowerCase().split(/\s+/).filter(Boolean);
  const sessions = new Map<string, Match[]>();
  for (const p of panes ?? []) {
    const m = matchPane(p, contents[p.id] ?? [], terms);
    if (m) sessions.set(p.sessionName, [...(sessions.get(p.sessionName) ?? []), m]);
  }

  return (
    <List
      isLoading={panes === undefined}
      isShowingDetail
      filtering={false}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search panes by session, command, path or content"
    >
      {panes !== undefined && sessions.size === 0 && (
        <List.EmptyView
          icon={Icon.Terminal}
          title={panes.length === 0 ? "No tmux panes" : "No matching panes"}
          description={panes.length === 0 ? "Is the tmux server running?" : undefined}
        />
      )}
      {[...sessions].map(([session, matches]) => (
        <List.Section key={session} title={session} subtitle={matches[0].pane.sessionAttached ? "attached" : undefined}>
          {matches.map(({ pane, target, contentLine }) => {
            const lines = contents[pane.id] ?? [];
            const isCurrent = pane.active && pane.windowActive && pane.sessionAttached;
            const hit = contentLine !== undefined ? lines[contentLine].trim() : undefined;
            return (
              <List.Item
                key={pane.id}
                id={pane.id}
                icon={{ source: Icon.Terminal, tintColor: isCurrent ? Color.Green : undefined }}
                title={`${pane.windowIndex}.${pane.paneIndex} ${pane.command}`}
                subtitle={pane.windowName}
                accessories={[
                  hit !== undefined
                    ? { icon: Icon.Text, text: hit.length > 40 ? `${hit.slice(0, 40)}…` : hit, tooltip: hit }
                    : { text: tildify(pane.path) },
                ]}
                detail={
                  <List.Item.Detail
                    markdown={"```\n" + previewText(lines, previewLines, contentLine) + "\n```"}
                    metadata={
                      <List.Item.Detail.Metadata>
                        <List.Item.Detail.Metadata.Label title="Target" text={`${target} (${pane.id})`} />
                        <List.Item.Detail.Metadata.Label title="Command" text={pane.command} />
                        <List.Item.Detail.Metadata.Label title="Path" text={tildify(pane.path)} />
                        <List.Item.Detail.Metadata.Label title="Title" text={pane.title} />
                        <List.Item.Detail.Metadata.Label title="Size" text={`${pane.width}×${pane.height}`} />
                        {hit !== undefined && (
                          <List.Item.Detail.Metadata.Label
                            title="Match"
                            text={`line ${contentLine! + 1} of ${lines.length}`}
                          />
                        )}
                      </List.Item.Detail.Metadata>
                    }
                  />
                }
                actions={
                  <ActionPanel>
                    <Action title="Switch to Pane" icon={Icon.AppWindow} onAction={() => jump(pane)} />
                    {hit !== undefined && (
                      <Action.CopyToClipboard
                        title="Copy Matching Line"
                        content={lines[contentLine!]}
                        shortcut={{ modifiers: ["ctrl"], key: "l" }}
                      />
                    )}
                    <Action.CopyToClipboard
                      title="Copy Pane Contents"
                      content={lines.join("\n")}
                      shortcut={{ modifiers: ["ctrl"], key: "c" }}
                    />
                    <Action.CopyToClipboard
                      title="Copy Path"
                      content={pane.path}
                      shortcut={{ modifiers: ["ctrl", "shift"], key: "c" }}
                    />
                    <Action
                      title="Refresh"
                      icon={Icon.ArrowClockwise}
                      shortcut={{ modifiers: ["ctrl"], key: "r" }}
                      onAction={refresh}
                    />
                    <Action
                      title="Kill Pane"
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      shortcut={{ modifiers: ["ctrl"], key: "x" }}
                      onAction={() => kill(pane)}
                    />
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      ))}
    </List>
  );
}
