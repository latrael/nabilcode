# Terminals

## Folder terminals

A project folder in the sidebar can hold terminals of its own, next to its
threads, without starting a conversation. Hover the folder and choose New
terminal, or right-click the folder. The shell starts in the project root. To
start in a thread's worktree instead, right-click the folder and choose New
terminal in worktree. When a folder groups the same project on several
machines, the menu asks which machine to use.

Click a terminal in the sidebar to open it in the main area, and click a thread
to go back to chatting. Leaving a terminal, or collapsing its folder, keeps the
shell running. Right-click a terminal to rename it, restart it after its shell
exits, or close it. Closing ends the shell and removes the entry. Removing the
project closes its folder terminals too.

The list of folder terminals is kept in this browser or desktop app, so another
device shows its own list. A shell does not survive its environment server
restarting; opening the terminal again starts a new shell in the same folder.

## History

Each terminal keeps up to 5,000 lines and 8 MiB of scrollback on its environment
server. T3 Code removes the oldest output when either limit is reached. A long
line can be shortened at the start. New terminal output is not truncated.

These limits apply when you reconnect and when T3 Code restores saved terminal
history. A client can show less scrollback than the server keeps.

On web and desktop, use Shift+PageUp and Shift+PageDown to read scrollback
without leaving terminal input. Ctrl+Shift+Home and Ctrl+Shift+End jump to the
start and latest output; use Cmd instead of Ctrl on macOS. Full-screen terminal
programs keep these navigation keys.

To copy all retained output, choose Select all in the terminal's context menu,
then copy. Cmd+A on macOS and Ctrl+Shift+A elsewhere select the same output.
Ctrl+A still moves to the beginning of shell input on Windows and Linux.
Jump to latest in the context menu returns to the current output.

On iPhone and iPad, long-press the terminal to paste or to choose Select Text.
Select Text shows the visible output, where you can copy text or tap a link.

## fish

T3 Code starts fish with `no-query-term`, avoiding startup waits for terminal
replies. This disables optional fish features that depend on those replies.
T3 Code's exported `fish_features` also hides any universal flags you set with
`set -U fish_features`.

To preserve those flags or enable queries with `query-term`, include them in
`fish_features` in the environment that launches T3 Code. A shell export applies
when you launch T3 Code from that shell; it does not configure a desktop app
launched from the Dock or Finder. Enabling queries can restore the startup wait.
