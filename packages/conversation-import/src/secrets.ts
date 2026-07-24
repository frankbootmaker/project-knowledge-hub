export type ContentWarningSeverity = 'info' | 'warning' | 'high';

export type ContentWarning = {
  code: string;
  severity: ContentWarningSeverity;
  count: number;
  /** Human-readable label; never includes matched secret text. */
  label: string;
};

type Detector = {
  code: string;
  severity: ContentWarningSeverity;
  label: string;
  pattern: RegExp;
};

const DETECTORS: Detector[] = [
  {
    code: 'aws_access_key',
    severity: 'high',
    label: 'Possible AWS access key id',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    code: 'github_pat',
    severity: 'high',
    label: 'Possible GitHub personal access token',
    pattern: /\bghp_[A-Za-z0-9]{20,}\b/g,
  },
  {
    code: 'github_fine_grained',
    severity: 'high',
    label: 'Possible GitHub fine-grained token',
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    code: 'slack_token',
    severity: 'high',
    label: 'Possible Slack token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    code: 'openai_sk',
    severity: 'high',
    label: 'Possible OpenAI-style API key',
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/g,
  },
  {
    code: 'private_key_pem',
    severity: 'high',
    label: 'PEM private key block',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    code: 'jwt_like',
    severity: 'warning',
    label: 'JWT-like bearer token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    code: 'password_assignment',
    severity: 'warning',
    label: 'Password / secret assignment',
    pattern:
      /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['"]?[^\s'"]{6,}/gi,
  },
  {
    code: 'connection_string',
    severity: 'warning',
    label: 'Database-style connection string with credentials',
    pattern: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:]+:[^\s@]+@/gi,
  },
];

/** Scan text for common secret patterns. Returns counts only — never matched values. */
export function detectContentSecrets(text: string): ContentWarning[] {
  if (!text) return [];
  const warnings: ContentWarning[] = [];
  for (const detector of DETECTORS) {
    const matches = text.match(detector.pattern);
    if (!matches?.length) continue;
    warnings.push({
      code: detector.code,
      severity: detector.severity,
      count: matches.length,
      label: detector.label,
    });
  }
  return warnings.sort((a, b) => {
    const rank = { high: 0, warning: 1, info: 2 } as const;
    return rank[a.severity] - rank[b.severity] || b.count - a.count;
  });
}

export function hasHighSeverityWarnings(warnings: ContentWarning[]): boolean {
  return warnings.some((w) => w.severity === 'high');
}
