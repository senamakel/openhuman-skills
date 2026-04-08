// Shared types for server-ping skill

export interface SkillConfig {
  serverUrl: string;
  pingIntervalSec: number;
  notifyOnDown: boolean;
  notifyOnRecover: boolean;
  verboseLogging: boolean;
}
