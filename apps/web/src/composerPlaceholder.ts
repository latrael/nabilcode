export const DEFAULT_COMPOSER_PLACEHOLDER = "Message #channel (tag @gemini, @claude, or @codex)";

export function channelNameForTitle(title: string | undefined): string {
  return title?.replace(/^#+\s*/, "").trim() || "new-channel";
}

export function composerPlaceholderForChannel(title: string | undefined): string {
  return `Message #${channelNameForTitle(title)} (tag @gemini, @claude, or @codex)`;
}
