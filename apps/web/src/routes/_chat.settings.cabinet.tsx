import { createFileRoute } from "@tanstack/react-router";

import { CabinetSettingsRoute } from "../components/settings/CabinetSettings";

export const Route = createFileRoute("/_chat/settings/cabinet")({
  component: CabinetSettingsRoute,
});
