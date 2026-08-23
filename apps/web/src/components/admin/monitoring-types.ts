/** Shared admin monitoring API payload (health + backups). */

export type MonitoringPayload = {
  overall: 'healthy' | 'degraded';
  generatedAt: string;
  app: {
    env: string;
    apiUrl: string;
    webUrl: string;
    schemaVersion: string;
  };
  health: {
    api: 'ok' | 'unknown';
    ready: boolean;
    checks: {
      postgres: 'ok' | 'error' | 'unknown';
      redis: 'ok' | 'error' | 'unknown';
    };
  };
  /** Set when the web could not load monitoring from the API (not a real dep failure). */
  loadError?: string | null;
  attention: {
    pendingUsers: number;
    pendingApiClients: number;
    staleBackup: boolean;
    staleBackupAfterHours: number;
    onDutyAdmins: Array<{ id: string; displayName: string; email: string }>;
  };
  sessions: { active: number };
  mcp: {
    range: string;
    requestCount: number;
    toolCallCount: number;
    toolErrorCount: number;
    topActions: Array<{ action: string; count: number }>;
    topTools?: Array<{
      toolName: string;
      via: 'mcp' | 'llm' | 'mixed';
      callCount: number;
      errorCount: number;
    }>;
  };
  clients: {
    range: string;
    leaderboard: Array<{
      actorId: string;
      clientName: string | null;
      requestCount: number;
      toolCallCount: number;
      toolErrorCount: number;
    }>;
  };
  catalogue: {
    range: string;
    topRecords: Array<{ entityId: string; label: string | null; count: number }>;
    topViewedRecords?: Array<{ entityId: string; label: string | null; count: number }>;
    topProjects: Array<{ entityId: string; label: string | null; count: number }>;
    topSystems: Array<{ entityId: string; label: string | null; count: number }>;
    search?: {
      searchCount: number;
      topQueryHashes: Array<{
        queryHash: string;
        queryLength: number | null;
        count: number;
      }>;
    };
  };
  maintenance: {
    embeddingProvider: string;
    workspaces: Array<{ id: string; name: string; slug: string }>;
    archived: {
      workspaces: number;
      projects: number;
      systems: number;
      knowledgeRecords: number;
    };
  };
  backups: {
    dir: string;
    toolsHint: string;
    lastSuccess: {
      stamp: {
        kind: string;
        at: string;
        artifact: string;
        schemaVersion: string;
        hostname: string;
      } | null;
      ageSeconds: number | null;
    };
    lastImport: {
      stamp: {
        kind: string;
        at: string;
        artifact: string;
        schemaVersion: string;
        hostname: string;
      } | null;
      ageSeconds: number | null;
    };
    lastFailure: {
      stamp: {
        kind: string;
        at: string;
        artifact: string;
        schemaVersion: string;
        hostname: string;
      } | null;
      ageSeconds: number | null;
    };
    artifacts: Array<{ name: string; sizeBytes: number; modifiedAt: string }>;
    totalBytes: number;
    maxUploadBytes: number;
    retention: {
      keepDaily: number;
      keepWeekly: number;
      keepMonthly: number;
      autoRotate: boolean;
      source: 'file' | 'env';
    };
    schedule: {
      enabled: boolean;
      intervalSeconds: number;
      source: 'file' | 'env';
    };
    scheduler?: {
      alive: boolean;
      heartbeat: {
        stamp: {
          kind: string;
          at: string;
          status: string;
          nextDueAt: string;
          detail: string;
          hostname: string;
        } | null;
        ageSeconds: number | null;
      };
    };
    lastOffsite: {
      stamp: {
        kind: string;
        at: string;
        artifact: string;
        schemaVersion: string;
        hostname: string;
        key: string;
        provider: string;
      } | null;
      ageSeconds: number | null;
    };
    offsite: {
      enabled: boolean;
      provider: string;
      auto: boolean;
    };
    staleAfterHours: number;
  };
};
