# vicinae-tmux

A [Vicinae](https://vicinae.com) extension for tmux panes.

**Search Tmux Panes** lists every pane across all sessions, grouped by session, with a live preview of each pane's output. Search matches session, window, command, path and the pane's scrollback (2000 lines by default); content hits show the matching line and the preview scrolls to it.

| Action | Shortcut |
| --- | --- |
| Switch to pane (and focus its terminal window) | `Enter` |
| Copy matching line | `Ctrl+L` |
| Copy pane contents | `Ctrl+C` |
| Copy pane path | `Ctrl+Shift+C` |
| Refresh | `Ctrl+R` |
| Kill pane | `Ctrl+X` |

When switching, the most recently active tmux client on that session is pointed at the pane. On Hyprland, the terminal window hosting that client is focused. If no client is attached, the configured terminal command (default `ghostty -e`) is launched with `tmux attach-session`.

## Development

```sh
npm install
npm run dev     # live-reload into a running vicinae
npm run build   # install into ~/.local/share/vicinae/extensions/tmux
```
