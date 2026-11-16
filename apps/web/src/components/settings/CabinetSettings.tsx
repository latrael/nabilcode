import { useAtomValue } from "@effect/atom-react";
import {
  AuthSettingsWriteScope,
  type CabinetStatus,
  type EnvironmentId,
  isSecretReference,
  type SettingsSecretValue,
} from "@t3tools/contracts";
import { CabinetMcpTransport } from "@t3tools/contracts/settings";
import { AsyncResult } from "effect/reactivity";
import { msg, T, useGT, useMessages } from "gt-react";
import { useState } from "react";

import { formatEnvironmentQueryError } from "~/state/query";
import { cabinetEnvironment } from "~/state/cabinet";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { CABINET_STATE_DISPLAY, cabinetStatusDetail } from "./CabinetSettings.logic";
import { SecretSourceInput, useSecretSources } from "./SecretSourceInput";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const MCP_TRANSPORT_LABELS: Readonly<Record<CabinetMcpTransport, string>> = {
  http: msg("HTTP"),
  stdio: msg("Standard input/output"),
};

const isMcpTransport = (value: unknown): value is CabinetMcpTransport =>
  CabinetMcpTransport.literals.some((literal) => literal === value);

export function CabinetSettingsRoute() {
  const { environment, scope } = useSettingsScope();
  if (!environment) {
    return (
      <p className="p-8 text-sm text-muted-foreground">
        {scope.kind === "environment"
          ? `Reconnect ${scope.label} to set up Cabinet.`
          : "Connect an environment to set up Cabinet."}
      </p>
    );
  }
  return (
    <CabinetSettings key={environment.environmentId} environmentId={environment.environmentId} />
  );
}

function CabinetSettings({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const m = useMessages();
  const cabinet = useEnvironmentSettings(environmentId, (settings) => settings.cabinet);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const secretSources = useSecretSources(environmentId);
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const status = useAtomValue(cabinetEnvironment.status({ environmentId, input: {} }));
  const testConnection = useAtomCommand(cabinetEnvironment.testConnection, {
    reportFailure: false,
  });
  // Values committed from the inputs may not have reached `cabinet` by the time Test is clicked.
  const [committed, setCommitted] = useState<{
    baseUrl?: string;
    token?: SettingsSecretValue;
  }>({});
  const [tokenValid, setTokenValid] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { readonly status: CabinetStatus } | { readonly error: string } | null
  >(null);

  const baseUrl = committed.baseUrl ?? cabinet.baseUrl;
  const token = committed.token ?? cabinet.token;
  const tokenConfigured = typeof token === "string" && token !== "";
  const saveBaseUrl = (next: string) => {
    const trimmed = next.trim();
    setCommitted((previous) => ({ ...previous, baseUrl: trimmed }));
    setTestResult(null);
    if (trimmed !== cabinet.baseUrl) updateSettings({ cabinet: { baseUrl: trimmed } });
  };
  const saveToken = (next: SettingsSecretValue) => {
    setCommitted((previous) => ({ ...previous, token: next }));
    setTestResult(null);
    updateSettings({ cabinet: { token: next } });
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await testConnection({
      environmentId,
      input: { baseUrl, token },
    });
    setTesting(false);
    setTestResult(
      result._tag === "Success"
        ? { status: result.value }
        : { error: formatEnvironmentQueryError(result.cause) },
    );
  };

  const liveStatus = AsyncResult.isSuccess(status) ? status.value : null;
  return (
    <SettingsPageContainer>
      <SettingsSection id="cabinet" title="Cabinet">
        <SettingsRow
          title={gt("Status")}
          description={
            liveStatus?.state === "disabled" ? (
              <T>Turn Cabinet on to connect.</T>
            ) : liveStatus ? (
              <span className="break-all">{liveStatus.baseUrl}</span>
            ) : undefined
          }
          control={<CabinetStatusBadge status={liveStatus} />}
        />
        <SettingsRow
          serverScoped
          {...searchableSetting("cabinet-enabled")}
          settingKeys={["cabinet"]}
          description={<T>Let this environment read and write your Cabinet library.</T>}
          control={
            <Switch
              checked={cabinet.enabled}
              onCheckedChange={(checked) =>
                updateSettings({ cabinet: { enabled: Boolean(checked) } })
              }
              aria-label={gt("Cabinet")}
            />
          }
        />
        <SettingsRow
          serverScoped
          {...searchableSetting("cabinet-base-url")}
          settingKeys={["cabinet"]}
          description={
            <T>
              Where Cabinet is running. Use 127.0.0.1 rather than localhost so Cabinet trusts the
              loopback connection.
            </T>
          }
          control={
            <DraftInput
              className="w-full sm:w-72"
              size="sm"
              font="mono"
              value={cabinet.baseUrl}
              onCommit={saveBaseUrl}
              placeholder="http://127.0.0.1:4747"
              spellCheck={false}
              aria-label={gt("Cabinet base URL")}
            />
          }
        />
        <SettingsRow
          serverScoped
          {...searchableSetting("cabinet-token")}
          settingKeys={["cabinet"]}
          description={
            <T>
              Optional on the same machine. Needed for MCP over HTTP and to attribute writes. For
              memory review, create it in Cabinet Settings, Agents, with &ldquo;Can review memory
              proposals&rdquo;.
            </T>
          }
          control={
            <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-72">
              <SecretSourceInput
                id="cabinet-token"
                aria-label={gt("Cabinet token")}
                value={isSecretReference(cabinet.token) ? cabinet.token : ""}
                configured={tokenConfigured}
                environmentId={environmentId}
                sources={secretSources}
                onCommit={(next) => saveToken(next.trim())}
                onSecretChange={(secret) => saveToken(secret ?? "")}
                onValidityChange={setTokenValid}
                size="sm"
              />
              {tokenConfigured ? (
                <Button size="xs" variant="outline" onClick={() => saveToken("")}>
                  {gt("Clear")}
                </Button>
              ) : null}
            </div>
          }
        />
        <SettingsRow
          serverScoped
          {...searchableSetting("cabinet-mcp-transport")}
          settingKeys={["cabinet"]}
          description={<T>How agents reach Cabinet&rsquo;s MCP tools. HTTP needs a token.</T>}
          control={
            <Select
              value={cabinet.mcpTransport}
              onValueChange={(value) => {
                if (isMcpTransport(value)) updateSettings({ cabinet: { mcpTransport: value } });
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-48" aria-label={gt("MCP transport")}>
                <SelectValue>{m(MCP_TRANSPORT_LABELS[cabinet.mcpTransport])}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {CabinetMcpTransport.literals.map((transport) => (
                  <SelectItem hideIndicator key={transport} value={transport}>
                    {m(MCP_TRANSPORT_LABELS[transport])}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          title={gt("Test connection")}
          description={
            testResult === null ? (
              <T>Tries the URL and token above, even before Cabinet is turned on.</T>
            ) : "error" in testResult ? (
              <span role="alert" className="text-destructive">
                {testResult.error}
              </span>
            ) : (
              <span role="status">
                <CabinetTestSummary status={testResult.status} />
              </span>
            )
          }
          control={
            <Button
              size="xs"
              variant="outline"
              aria-busy={testing}
              disabled={testing || !canWrite || !tokenValid}
              onClick={() => void runTest()}
            >
              {/* Keeps the label's width while testing, so the row never reflows. */}
              <span className="relative">
                <span className={testing ? "invisible" : undefined}>{gt("Test connection")}</span>
                {testing ? (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <Spinner />
                  </span>
                ) : null}
              </span>
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function CabinetStatusBadge({ status }: { readonly status: CabinetStatus | null }) {
  const m = useMessages();
  if (status === null) return <Spinner />;
  const display = CABINET_STATE_DISPLAY[status.state];
  const detail = cabinetStatusDetail(status);
  return (
    <span role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
      {detail}
      <Badge variant={display.variant}>{m(display.label)}</Badge>
    </span>
  );
}

function CabinetTestSummary({ status }: { readonly status: CabinetStatus }) {
  const m = useMessages();
  const detail = cabinetStatusDetail(status);
  return (
    <>
      {m(CABINET_STATE_DISPLAY[status.state].label)}
      {detail ? ` · ${detail}` : ""}
    </>
  );
}
