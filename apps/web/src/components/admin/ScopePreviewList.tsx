'use client';

import { useCallback, useId, useRef, useState } from 'react';
import { oauthGrantScopePreview } from './oauth-grant-list';
import { AnchoredPopover } from '../ui/TableFilterControl';

function ScopeTags({ scopes }: { scopes: readonly string[] }) {
  return (
    <>
      {scopes.map((scope) => (
        <span key={scope} className="kh-ops-tag">
          {scope}
        </span>
      ))}
    </>
  );
}

export function ScopePreviewList({
  scopes,
  title,
  moreLabel,
  hideLabel,
}: {
  scopes: readonly string[];
  title: string;
  moreLabel: (count: number) => string;
  hideLabel: string;
}) {
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);
  const preview = oauthGrantScopePreview(scopes);
  if (scopes.length === 0) return <span className="text-ink-muted">—</span>;

  return (
    <div className="kh-ops-scope-list kh-ops-scope-list--inline">
      <ScopeTags scopes={preview.shown} />
      {preview.more > 0 ? (
        <button
          ref={triggerRef}
          type="button"
          className="kh-ops-tag"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={open ? panelId : undefined}
          aria-label={open ? hideLabel : moreLabel(preview.more)}
          onClick={() => setOpen((current) => !current)}
        >
          +{preview.more}
        </button>
      ) : null}
      {open && triggerRef.current ? (
        <AnchoredPopover id={panelId} anchor={triggerRef.current} label={title} onClose={close}>
          <div className="kh-ops-scope-list kh-ops-scope-list--inline">
            <ScopeTags scopes={scopes} />
          </div>
        </AnchoredPopover>
      ) : null}
    </div>
  );
}
