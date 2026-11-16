import { msg } from "gt-react";

import type { BoardLayoutPreset, BoardPresetId } from "./board/board.types";

/** The top bar's view switch: three named presets of the active board. */
export const TOP_BAR_VIEWS = [
  { preset: "bento", label: msg("Board") },
  { preset: "focus", label: msg("Focus Chat") },
  { preset: "split", label: msg("Split Review") },
] as const satisfies ReadonlyArray<{ preset: BoardPresetId; label: unknown }>;

/** A custom or 2x2 layout matches no view, so no segment shows pressed. */
export function activeTopBarView(preset: BoardLayoutPreset): BoardPresetId | null {
  return TOP_BAR_VIEWS.find((view) => view.preset === preset)?.preset ?? null;
}
