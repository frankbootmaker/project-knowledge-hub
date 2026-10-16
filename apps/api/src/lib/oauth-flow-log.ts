import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';

const USER_AGENT_MAX = 120;

export type OauthFlowStep = 'authorize' | 'consent_request' | 'consent' | 'token';

export type OauthFlowOutcome =
  | { kind: 'success' }
  | { kind: 'error'; code: string };

export function truncateUserAgent(userAgent: string | undefined): string | undefined {
  if (!userAgent) {
    return undefined;
  }
  if (userAgent.length <= USER_AGENT_MAX) {
    return userAgent;
  }
  return `${userAgent.slice(0, USER_AGENT_MAX)}…`;
}

export function secretHashPrefix(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

export function logOauthFlow(
  log: FastifyBaseLogger,
  step: OauthFlowStep,
  fields: {
    clientId?: string;
    redirectUri?: string;
    txnId?: string;
    stateHash?: string;
    codeHash?: string;
    userAgent?: string;
    outcome: OauthFlowOutcome;
  },
): void {
  const outcome = fields.outcome.kind === 'success' ? 'success' : fields.outcome.code;
  log.info(
    {
      event: 'oauth_flow',
      step,
      clientId: fields.clientId,
      redirectUri: fields.redirectUri,
      txnId: fields.txnId,
      stateHash: fields.stateHash,
      codeHash: fields.codeHash,
      userAgent: truncateUserAgent(fields.userAgent),
      outcome,
    },
    'oauth flow',
  );
}
