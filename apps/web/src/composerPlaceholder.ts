export const DEFAULT_COMPOSER_PLACEHOLDER = "Ask anything. @ files, $ skills, / commands";

const AGENT_NAME_OVERRIDES: Record<string, string> = { claudeAgent: "Claude Code" };

export function composerPlaceholderForProvider(
  provider: string,
  displayNames: Partial<Record<string, string>>,
  instanceDisplayName?: string,
): string {
  const agent = AGENT_NAME_OVERRIDES[provider] ?? instanceDisplayName ?? displayNames[provider];
  return agent
    ? `Message ${agent}. Type @ to mention Cabinet notes or PDFs`
    : DEFAULT_COMPOSER_PLACEHOLDER;
}
