/// <reference types="@vicinae/api">

/*
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 */

type ExtensionPreferences = {
  /** Terminal command - Used to attach when no tmux client is running. The tmux attach command is appended. */
	"terminalCommand"?: string;

	/** Preview lines - How many lines of pane output to show in the preview */
	"previewLines"?: string;

	/** Search depth - How many lines of scrollback per pane are searched */
	"searchLines"?: string;
}

declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Command: Search Tmux Panes */
	export type SearchPanes = ExtensionPreferences & {
		
	}
}

declare namespace Arguments {
  /** Command: Search Tmux Panes */
	export type SearchPanes = {
		
	}
}