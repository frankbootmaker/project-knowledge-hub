'use client';

import { useTranslations } from 'next-intl';
import { Button, Panel, useToast } from '../ui';

export function OauthConnectGuide({
  resourceUrl,
  enabled,
  audience,
}: {
  resourceUrl: string;
  enabled: boolean;
  audience: 'admin' | 'user';
}) {
  const tAdmin = useTranslations('admin');
  const tUser = useTranslations('aiConnections');
  const { pushToast } = useToast();
  const title =
    audience === 'admin' ? tAdmin('oauthConnectTitle') : tUser('oauthConnectTitle');

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(resourceUrl);
      pushToast(tAdmin('oauthResourceCopied'));
    } catch {
      pushToast(tAdmin('oauthResourceCopyFailed'), 'danger');
    }
  }

  if (!enabled && audience === 'user') {
    return (
      <Panel className="grid gap-2 p-4">
        <h2 className="m-0 text-base font-semibold">{title}</h2>
        <p className="m-0 text-sm text-ink-muted">{tUser('oauthConnectOff')}</p>
      </Panel>
    );
  }

  return (
    <Panel className="grid gap-3 p-4">
      <div>
        <h2 className="m-0 text-base font-semibold">{title}</h2>
        <p className="m-0 mt-1 text-sm text-ink-muted">{tAdmin('oauthConnectBlurb')}</p>
      </div>
      {!enabled ? (
        <p className="m-0 text-sm text-ink-muted">{tAdmin('oauthConnectNotLive')}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-sm">{resourceUrl}</code>
        <Button type="button" variant="secondary" onClick={() => void copyUrl()}>
          {tAdmin('oauthResourceCopy')}
        </Button>
      </div>
      <ol className="m-0 grid list-decimal gap-1 pl-5 text-sm">
        <li>{tAdmin('oauthConnectStep1')}</li>
        <li>{tAdmin('oauthConnectStep2')}</li>
        <li>{tAdmin('oauthConnectStep3')}</li>
      </ol>
      <p className="m-0 text-sm text-ink-muted">{tAdmin('oauthConnectOtherClients')}</p>
      {audience === 'admin' ? (
        <p className="m-0 text-sm text-ink-muted">{tAdmin('oauthConnectGuideHint')}</p>
      ) : null}
    </Panel>
  );
}
