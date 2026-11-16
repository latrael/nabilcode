import { createCabinetEnvironmentAtoms } from "@t3tools/client-runtime/state/cabinet";

import { connectionAtomRuntime } from "../connection/runtime";

export const cabinetEnvironment = createCabinetEnvironmentAtoms(connectionAtomRuntime);
