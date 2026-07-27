import { normalizeAppLocale, type AppLocale } from '@project-knowledge-hub/domain';

/** UI labels for knowledge export chrome and {type}/{status} tokens. */

const LIFECYCLE_LABELS: Record<AppLocale, Record<string, string>> = {
  en: {
    "draft": "Draft",
    "review_required": "Review required",
    "verified": "Approved",
    "current": "Current",
    "superseded": "Superseded",
    "deprecated": "Deprecated",
    "archived": "Archived",
  },
  de: {
    "draft": "Entwurf",
    "review_required": "Prüfung erforderlich",
    "verified": "Genehmigt",
    "current": "Aktuell",
    "superseded": "Ersetzt",
    "deprecated": "Veraltet",
    "archived": "Archiviert",
  },
  hu: {
    "draft": "Piszkozat",
    "review_required": "Ellenőrzés szükséges",
    "verified": "Jóváhagyva",
    "current": "Aktuális",
    "superseded": "Felülírva",
    "deprecated": "Elavult",
    "archived": "Archiválva",
  },
};

const RECORD_TYPE_LABELS: Record<AppLocale, Record<string, string>> = {
  en: {
    "overview": "Overview",
    "architecture": "Architecture",
    "deployment-guide": "Deployment guide",
    "installation-guide": "Installation guide",
    "configuration": "Configuration",
    "configuration-snapshot": "Configuration snapshot",
    "runbook": "Runbook",
    "troubleshooting": "Troubleshooting",
    "incident-resolution": "Incident resolution",
    "migration-guide": "Migration guide",
    "decision": "Decision",
    "lessons-learned": "Lessons learned",
    "command-reference": "Command reference",
    "inventory": "Inventory",
    "status": "Status",
    "management-summary": "Management summary",
    "progress-summary": "Progress summary",
    "roadmap": "Roadmap",
    "recovery-guide": "Recovery guide",
    "backup-guide": "Backup guide",
    "security-note": "Security note",
    "integration-guide": "Integration guide",
    "conversation-summary": "Conversation summary",
    "research-note": "Research note",
    "proposal": "Proposal",
    "business-idea": "Business idea",
    "vision": "Vision",
    "plan": "Plan",
    "initiative": "Initiative",
    "invoice": "Invoice",
    "note": "Note",
    "other": "Other",
  },
  de: {
    "overview": "Überblick",
    "architecture": "Architektur",
    "deployment-guide": "Deployment-Leitfaden",
    "installation-guide": "Installationsleitfaden",
    "configuration": "Konfiguration",
    "configuration-snapshot": "Konfigurationssnapshot",
    "runbook": "Runbook",
    "troubleshooting": "Fehlerbehebung",
    "incident-resolution": "Incident-Auflösung",
    "migration-guide": "Migrationsleitfaden",
    "decision": "Entscheidung",
    "lessons-learned": "Lessons Learned",
    "command-reference": "Befehlsreferenz",
    "inventory": "Inventar",
    "status": "Status",
    "management-summary": "Management-Zusammenfassung",
    "progress-summary": "Fortschrittszusammenfassung",
    "roadmap": "Roadmap",
    "recovery-guide": "Wiederherstellungsleitfaden",
    "backup-guide": "Backup-Leitfaden",
    "security-note": "Sicherheitsnotiz",
    "integration-guide": "Integrationsleitfaden",
    "conversation-summary": "Gesprächszusammenfassung",
    "research-note": "Forschungsnotiz",
    "proposal": "Vorschlag",
    "business-idea": "Geschäftsidee",
    "vision": "Vision",
    "plan": "Plan",
    "initiative": "Initiative",
    "invoice": "Rechnung",
    "note": "Notiz",
    "other": "Sonstiges",
  },
  hu: {
    "overview": "Áttekintés",
    "architecture": "Architektúra",
    "deployment-guide": "Telepítési útmutató (deploy)",
    "installation-guide": "Telepítési útmutató",
    "configuration": "Konfiguráció",
    "configuration-snapshot": "Konfigurációs pillanatkép",
    "runbook": "Üzemeltetési eljárás",
    "troubleshooting": "Hibaelhárítás",
    "incident-resolution": "Incidenslezárás",
    "migration-guide": "Migrációs útmutató",
    "decision": "Döntés",
    "lessons-learned": "Tanulságok",
    "command-reference": "Parancsreferencia",
    "inventory": "Leltár",
    "status": "Állapot",
    "management-summary": "Vezetői összefoglaló",
    "progress-summary": "Haladásösszefoglaló",
    "roadmap": "Ütemterv",
    "recovery-guide": "Helyreállítási útmutató",
    "backup-guide": "Mentési útmutató",
    "security-note": "Biztonsági jegyzet",
    "integration-guide": "Integrációs útmutató",
    "conversation-summary": "Beszélgetés-összefoglaló",
    "research-note": "Kutatási jegyzet",
    "proposal": "Javaslat",
    "business-idea": "Üzleti ötlet",
    "vision": "Jövőkép",
    "plan": "Terv",
    "initiative": "Kezdeményezés",
    "invoice": "Számla",
    "note": "Jegyzet",
    "other": "Egyéb",
  },
};

const CHROME_COPY: Record<AppLocale, { exported: string }> = {
  en: { exported: "Exported" },
  de: { exported: "Exportiert" },
  hu: { exported: "Exportálva" },
};

export function normalizeExportLocale(value: string | null | undefined): AppLocale {
  const key = value?.trim().toLowerCase().slice(0, 2);
  return normalizeAppLocale(key);
}

export function labelLifecycleStatus(
  status: string,
  locale: string | null | undefined,
): string {
  const loc = normalizeExportLocale(locale);
  return LIFECYCLE_LABELS[loc][status] ?? LIFECYCLE_LABELS.en[status] ?? status;
}

export function labelRecordType(
  recordType: string,
  locale: string | null | undefined,
): string {
  const loc = normalizeExportLocale(locale);
  return (
    RECORD_TYPE_LABELS[loc][recordType] ??
    RECORD_TYPE_LABELS.en[recordType] ??
    recordType
  );
}

export function exportChromeCopy(locale: string | null | undefined): { exported: string } {
  return CHROME_COPY[normalizeExportLocale(locale)];
}
