/** Accepts both sync and async — skills should prefer sync. */
type MaybeAsync<T> = T | Promise<T>;

interface Skill {
  info: {
    id: string;
    name: string;
    version: string;
    description: string;
    auto_start: boolean;
    setup: { required: boolean; label: string };
  };
  tools: ToolDefinition[];
  init: () => MaybeAsync<void>;
  start: () => MaybeAsync<void>;
  stop: () => MaybeAsync<void>;
  onCronTrigger?: (scheduleId: string) => MaybeAsync<void>;
  onSetupStart?: () => MaybeAsync<SetupStartResult>;
  onSetupSubmit?: (args: {
    stepId: string;
    values: Record<string, unknown>;
  }) => MaybeAsync<SetupSubmitResult>;
  onSetupCancel?: () => MaybeAsync<void>;
  onOAuthComplete?: (args: OAuthCompleteArgs) => MaybeAsync<unknown>;
  /** Called when advanced auth credentials are submitted (self_hosted / text modes). */
  onAuthComplete?: (args: {
    mode: string;
    credentials: Record<string, unknown>;
  }) => MaybeAsync<{
    status: string;
    errors?: Array<{ field: string; message: string }>;
    message?: string;
  }>;
  /** Called when advanced auth credentials are revoked. */
  onAuthRevoked?: (args: { mode?: string }) => MaybeAsync<void>;
  onDisconnect?: () => MaybeAsync<void>;
  publishState?: () => MaybeAsync<void>;
  onOAuthRevoked?: (args: OAuthRevokedArgs) => MaybeAsync<void>;
  onListOptions?: () => MaybeAsync<{ options: SkillOption[] }>;
  onSetOption?: (args: { name: string; value: unknown }) => MaybeAsync<void>;
  onSessionStart?: (args: { sessionId: string }) => MaybeAsync<void>;
  onSessionEnd?: (args: { sessionId: string }) => MaybeAsync<void>;
  onTick?: () => MaybeAsync<void>;
  onSync?: () => MaybeAsync<void>;
  onPing?: () => MaybeAsync<PingResult>;
  /** Called when the frontend sends load params (e.g. wallet address for wallet skill). */
  onLoad?: (params: Record<string, unknown>) => MaybeAsync<void>;
  onRpc?: (args: { method: string; params: unknown }) => unknown;
  onServerEvent?: (event: string, data: unknown) => MaybeAsync<void>;
  /**
   * Called when an unhandled error occurs during async operations.
   */
  onError?: (args: SkillErrorArgs) => MaybeAsync<void>;
}
