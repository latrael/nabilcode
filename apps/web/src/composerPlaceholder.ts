export const DEFAULT_COMPOSER_PLACEHOLDER = "Message #channel (tag @gemini, @claude, or @codex)";

export function composerPlaceholderForChannel(title: string | undefined): string {
  const channel = title?.replace(/^#+\s*/, "").trim() || "new-channel";
  return `Message #${channel} (tag @gemini, @claude, or @codex)`;
}
