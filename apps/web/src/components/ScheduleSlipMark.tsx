export function ScheduleSlipMark({ label }: { label: string }) {
  return (
    <span className="kh-ops-schedule-slip" role="img" aria-label={label} title={label}>
      !
    </span>
  );
}
