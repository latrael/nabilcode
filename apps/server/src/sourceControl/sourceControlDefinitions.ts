import { builtInSourceControlDefinitions } from "@t3tools/source-control-definitions/registry";
import * as GitHubDriver from "@t3tools/source-control-github/server/driver";

export const BUILT_IN_SOURCE_CONTROL_DRIVER_LIST = [GitHubDriver.driver] as const;

export const sourceControlDefinitions = builtInSourceControlDefinitions;
