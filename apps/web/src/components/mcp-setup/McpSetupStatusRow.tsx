import { Badge } from '../ui';

export function McpSetupStatusRow({
  ok,
  skipped,
  label,
  detail,
}: {
  ok: boolean;
  skipped?: boolean;
  label: string;
  detail: string;
}) {
  const tone = skipped ? 'neutral' : ok ? 'success' : 'danger';
  return (
    <div className="kh-ops-status-row">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p>{detail}</p>
      </div>
      <Badge tone={tone}>{skipped ? 'skipped' : ok ? 'ok' : 'fail'}</Badge>
    </div>
  );
}
