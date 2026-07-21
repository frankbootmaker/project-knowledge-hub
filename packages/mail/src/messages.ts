import type { AppLocale } from '@project-knowledge-hub/domain';

export type MailMessages = {
  brandName: string;
  appName: string;
  footerNote: string;
  ctaFallback: string;
  passwordReset: {
    subject: string;
    title: string;
    greeting: string;
    body: string;
    cta: string;
    ignore: string;
  };
  invite: {
    subject: string;
    title: string;
    greeting: string;
    body: string;
    cta: string;
    ignore: string;
  };
  emailConfirm: {
    subject: string;
    title: string;
    greeting: string;
    body: string;
    after: string;
    cta: string;
    ignore: string;
  };
  accountApproved: {
    subject: string;
    title: string;
    greeting: string;
    body: string;
    cta: string;
  };
  passwordChanged: {
    subject: string;
    title: string;
    greeting: string;
    body: string;
    bodyExtra: string;
    cta: string;
  };
  accountClosed: {
    subject: string;
    title: string;
    greeting: string;
    body: string;
    bodyExtra: string;
  };
  signupRejected: {
    subject: string;
    title: string;
    greeting: string;
    body: string;
  };
  aiConnectionPending: {
    subject: string;
    title: string;
    greeting: string;
    body: string;
    agentLabel: string;
    cta: string;
  };
  aiConnectionApproved: {
    subject: string;
    title: string;
    greeting: string;
    body: string;
    agentLabel: string;
    cta: string;
  };
  aiConnectionRejected: {
    subject: string;
    title: string;
    greeting: string;
    body: string;
    agentLabel: string;
    cta: string;
  };
  testEmail: {
    subject: string;
    title: string;
    greeting: string;
    body: string;
    driverLabel: string;
    sourceLabel: string;
    fromLabel: string;
    cta: string;
  };
};

export const en: MailMessages = {
  brandName: 'IN3 Technology',
  appName: 'Project Knowledge Hub',
  footerNote:
    'You received this email because of activity on your Project Knowledge Hub account.',
  ctaFallback: 'Or copy and paste this link into your browser:',
  passwordReset: {
    subject: 'Reset your Project Knowledge Hub password',
    title: 'Reset your password',
    greeting: 'Hi {name},',
    body: 'We received a request to reset your password. Use the button below to choose a new one. This link expires soon.',
    cta: 'Choose a new password',
    ignore: 'If you did not request this, you can ignore this email.',
  },
  invite: {
    subject: 'You are invited to Project Knowledge Hub',
    title: 'You are invited',
    greeting: 'Hi {name},',
    body: 'You have been invited to Project Knowledge Hub. Set your password to activate your account.',
    cta: 'Set your password',
    ignore: 'If you were not expecting this invitation, you can ignore this email.',
  },
  emailConfirm: {
    subject: 'Confirm your Project Knowledge Hub email',
    title: 'Confirm your email',
    greeting: 'Hi {name},',
    body: 'Thanks for signing up for Project Knowledge Hub. Confirm your email address to continue.',
    after:
      'After confirmation, an administrator must approve your access before you can sign in.',
    cta: 'Confirm your email',
    ignore: 'If you did not create an account, you can ignore this email.',
  },
  accountApproved: {
    subject: 'Your Project Knowledge Hub account is ready',
    title: 'Account approved',
    greeting: 'Hi {name},',
    body: 'An administrator has approved your account. You can sign in now.',
    cta: 'Sign in',
  },
  passwordChanged: {
    subject: 'Your Project Knowledge Hub password was changed',
    title: 'Password changed',
    greeting: 'Hi {name},',
    body: 'Your account password was just changed.',
    bodyExtra:
      'If you did not make this change, reset your password immediately and contact an administrator.',
    cta: 'Sign in',
  },
  accountClosed: {
    subject: 'Your Project Knowledge Hub account was closed',
    title: 'Account closed',
    greeting: 'Hi {name},',
    body: 'Your Project Knowledge Hub account has been closed. You can no longer sign in with this email.',
    bodyExtra:
      'Authored knowledge may remain in the hub. Contact an administrator if you need access again.',
  },
  signupRejected: {
    subject: 'Your Project Knowledge Hub signup was not approved',
    title: 'Signup not approved',
    greeting: 'Hi {name},',
    body: 'An administrator did not approve your signup request. The account has been disabled. Contact an administrator if you believe this is a mistake.',
  },
  aiConnectionPending: {
    subject: 'AI connection request pending approval',
    title: 'AI connection request',
    greeting: 'Hi {name},',
    body: 'An AI agent requested API access using your pairing code. Review and approve or reject the request.',
    agentLabel: 'Agent: {agent}',
    cta: 'Manage AI connections',
  },
  aiConnectionApproved: {
    subject: 'AI connection approved',
    title: 'AI connection approved',
    greeting: 'Hi {name},',
    body: 'An AI connection for your account was approved and can now use the API with the granted scopes.',
    agentLabel: 'Agent: {agent}',
    cta: 'View AI connections',
  },
  aiConnectionRejected: {
    subject: 'AI connection rejected',
    title: 'AI connection rejected',
    greeting: 'Hi {name},',
    body: 'An AI connection request for your account was rejected.',
    agentLabel: 'Agent: {agent}',
    cta: 'View AI connections',
  },
  testEmail: {
    subject: 'Project Knowledge Hub — test email',
    title: 'Test email',
    greeting: 'Hi {name},',
    body: 'This is a test message from Project Knowledge Hub. Mail delivery is working with the settings below.',
    driverLabel: 'Driver: {driver}',
    sourceLabel: 'Config source: {source}',
    fromLabel: 'From: {from}',
    cta: 'Open mail settings',
  },
};

export const de: MailMessages = {
  brandName: 'IN3 Technology',
  appName: 'Project Knowledge Hub',
  footerNote:
    'Sie erhalten diese E-Mail wegen einer Aktivität an Ihrem Project Knowledge Hub-Konto.',
  ctaFallback: 'Oder kopieren Sie diesen Link in Ihren Browser:',
  passwordReset: {
    subject: 'Passwort für Project Knowledge Hub zurücksetzen',
    title: 'Passwort zurücksetzen',
    greeting: 'Hallo {name},',
    body: 'Wir haben eine Anfrage zum Zurücksetzen Ihres Passworts erhalten. Nutzen Sie die Schaltfläche unten, um ein neues zu wählen. Der Link läuft bald ab.',
    cta: 'Neues Passwort wählen',
    ignore: 'Wenn Sie dies nicht angefordert haben, können Sie diese E-Mail ignorieren.',
  },
  invite: {
    subject: 'Einladung zum Project Knowledge Hub',
    title: 'Sie sind eingeladen',
    greeting: 'Hallo {name},',
    body: 'Sie wurden zum Project Knowledge Hub eingeladen. Legen Sie ein Passwort fest, um Ihr Konto zu aktivieren.',
    cta: 'Passwort festlegen',
    ignore: 'Wenn Sie diese Einladung nicht erwartet haben, können Sie diese E-Mail ignorieren.',
  },
  emailConfirm: {
    subject: 'E-Mail für Project Knowledge Hub bestätigen',
    title: 'E-Mail bestätigen',
    greeting: 'Hallo {name},',
    body: 'Danke für Ihre Registrierung beim Project Knowledge Hub. Bestätigen Sie Ihre E-Mail-Adresse, um fortzufahren.',
    after:
      'Nach der Bestätigung muss ein Administrator Ihren Zugang freigeben, bevor Sie sich anmelden können.',
    cta: 'E-Mail bestätigen',
    ignore: 'Wenn Sie kein Konto erstellt haben, können Sie diese E-Mail ignorieren.',
  },
  accountApproved: {
    subject: 'Ihr Project Knowledge Hub-Konto ist bereit',
    title: 'Konto freigegeben',
    greeting: 'Hallo {name},',
    body: 'Ein Administrator hat Ihr Konto freigegeben. Sie können sich jetzt anmelden.',
    cta: 'Anmelden',
  },
  passwordChanged: {
    subject: 'Ihr Project Knowledge Hub-Passwort wurde geändert',
    title: 'Passwort geändert',
    greeting: 'Hallo {name},',
    body: 'Das Passwort Ihres Kontos wurde soeben geändert.',
    bodyExtra:
      'Wenn Sie diese Änderung nicht vorgenommen haben, setzen Sie Ihr Passwort sofort zurück und kontaktieren Sie einen Administrator.',
    cta: 'Anmelden',
  },
  accountClosed: {
    subject: 'Ihr Project Knowledge Hub-Konto wurde geschlossen',
    title: 'Konto geschlossen',
    greeting: 'Hallo {name},',
    body: 'Ihr Project Knowledge Hub-Konto wurde geschlossen. Mit dieser E-Mail können Sie sich nicht mehr anmelden.',
    bodyExtra:
      'Verfasste Wissenseinträge können im Hub verbleiben. Kontaktieren Sie einen Administrator, wenn Sie erneut Zugang benötigen.',
  },
  signupRejected: {
    subject: 'Ihre Project Knowledge Hub-Registrierung wurde nicht freigegeben',
    title: 'Registrierung nicht freigegeben',
    greeting: 'Hallo {name},',
    body: 'Ein Administrator hat Ihre Registrierungsanfrage nicht freigegeben. Das Konto wurde deaktiviert. Kontaktieren Sie einen Administrator, wenn Sie dies für einen Fehler halten.',
  },
  aiConnectionPending: {
    subject: 'KI-Verbindungsanfrage wartet auf Freigabe',
    title: 'KI-Verbindungsanfrage',
    greeting: 'Hallo {name},',
    body: 'Ein KI-Agent hat mit Ihrem Pairing-Code API-Zugang angefordert. Prüfen Sie die Anfrage und geben Sie sie frei oder lehnen Sie sie ab.',
    agentLabel: 'Agent: {agent}',
    cta: 'KI-Verbindungen verwalten',
  },
  aiConnectionApproved: {
    subject: 'KI-Verbindung freigegeben',
    title: 'KI-Verbindung freigegeben',
    greeting: 'Hallo {name},',
    body: 'Eine KI-Verbindung für Ihr Konto wurde freigegeben und kann die API mit den gewährten Berechtigungen nutzen.',
    agentLabel: 'Agent: {agent}',
    cta: 'KI-Verbindungen anzeigen',
  },
  aiConnectionRejected: {
    subject: 'KI-Verbindung abgelehnt',
    title: 'KI-Verbindung abgelehnt',
    greeting: 'Hallo {name},',
    body: 'Eine KI-Verbindungsanfrage für Ihr Konto wurde abgelehnt.',
    agentLabel: 'Agent: {agent}',
    cta: 'KI-Verbindungen anzeigen',
  },
  testEmail: {
    subject: 'Project Knowledge Hub — Test-E-Mail',
    title: 'Test-E-Mail',
    greeting: 'Hallo {name},',
    body: 'Dies ist eine Testnachricht von Project Knowledge Hub. Der E-Mail-Versand funktioniert mit den folgenden Einstellungen.',
    driverLabel: 'Treiber: {driver}',
    sourceLabel: 'Konfigurationsquelle: {source}',
    fromLabel: 'Absender: {from}',
    cta: 'E-Mail-Einstellungen öffnen',
  },
};

export const hu: MailMessages = {
  brandName: 'IN3 Technology',
  appName: 'Project Knowledge Hub',
  footerNote:
    'Ezt az e-mailt a Project Knowledge Hub fiókoddal kapcsolatos tevékenység miatt kapod.',
  ctaFallback: 'Vagy másold be ezt a linket a böngésződbe:',
  passwordReset: {
    subject: 'Project Knowledge Hub jelszó visszaállítása',
    title: 'Jelszó visszaállítása',
    greeting: 'Szia {name}!',
    body: 'Jelszó-visszaállítási kérelmet kaptunk. Az alábbi gombbal új jelszót választhatsz. A link hamarosan lejár.',
    cta: 'Új jelszó választása',
    ignore: 'Ha nem te kérted, nyugodtan hagyd figyelmen kívül ezt az e-mailt.',
  },
  invite: {
    subject: 'Meghívó a Project Knowledge Hubba',
    title: 'Meghívót kaptál',
    greeting: 'Szia {name}!',
    body: 'Meghívtak a Project Knowledge Hubba. Állíts be jelszót a fiók aktiválásához.',
    cta: 'Jelszó beállítása',
    ignore: 'Ha nem vártad ezt a meghívót, hagyd figyelmen kívül ezt az e-mailt.',
  },
  emailConfirm: {
    subject: 'Erősítsd meg a Project Knowledge Hub e-mail címed',
    title: 'E-mail megerősítése',
    greeting: 'Szia {name}!',
    body: 'Köszönjük a Project Knowledge Hub regisztrációt. Erősítsd meg az e-mail címed a folytatáshoz.',
    after:
      'A megerősítés után egy adminisztrátornak jóvá kell hagynia a hozzáférésedet, mielőtt bejelentkezhetnél.',
    cta: 'E-mail megerősítése',
    ignore: 'Ha nem te hoztál létre fiókot, hagyd figyelmen kívül ezt az e-mailt.',
  },
  accountApproved: {
    subject: 'A Project Knowledge Hub fiókod kész',
    title: 'Fiók jóváhagyva',
    greeting: 'Szia {name}!',
    body: 'Egy adminisztrátor jóváhagyta a fiókodat. Most már bejelentkezhetsz.',
    cta: 'Bejelentkezés',
  },
  passwordChanged: {
    subject: 'A Project Knowledge Hub jelszavad megváltozott',
    title: 'Jelszó megváltozott',
    greeting: 'Szia {name}!',
    body: 'A fiókod jelszava most változott meg.',
    bodyExtra:
      'Ha nem te változtattad meg, azonnal állítsd vissza a jelszavad, és vedd fel a kapcsolatot egy adminisztrátorral.',
    cta: 'Bejelentkezés',
  },
  accountClosed: {
    subject: 'A Project Knowledge Hub fiókod bezárásra került',
    title: 'Fiók bezárva',
    greeting: 'Szia {name}!',
    body: 'A Project Knowledge Hub fiókodat bezárták. Ezzel az e-maillel már nem tudsz bejelentkezni.',
    bodyExtra:
      'Az általad írt tudásbejegyzések a hubban maradhatnak. Új hozzáféréshez vedd fel a kapcsolatot egy adminisztrátorral.',
  },
  signupRejected: {
    subject: 'A Project Knowledge Hub regisztrációdat nem hagyták jóvá',
    title: 'Regisztráció elutasítva',
    greeting: 'Szia {name}!',
    body: 'Egy adminisztrátor nem hagyta jóvá a regisztrációs kérelmedet. A fiók le lett tiltva. Ha szerinted ez hiba, vedd fel a kapcsolatot egy adminisztrátorral.',
  },
  aiConnectionPending: {
    subject: 'AI-kapcsolat kérelem jóváhagyásra vár',
    title: 'AI-kapcsolat kérelem',
    greeting: 'Szia {name}!',
    body: 'Egy AI-ügynök a párosító kódoddal API-hozzáférést kért. Nézd át, majd hagyd jóvá vagy utasítsd el.',
    agentLabel: 'Ügynök: {agent}',
    cta: 'AI-kapcsolatok kezelése',
  },
  aiConnectionApproved: {
    subject: 'AI-kapcsolat jóváhagyva',
    title: 'AI-kapcsolat jóváhagyva',
    greeting: 'Szia {name}!',
    body: 'A fiókodhoz tartozó AI-kapcsolatot jóváhagyták, és a megadott jogosultságokkal használhatja az API-t.',
    agentLabel: 'Ügynök: {agent}',
    cta: 'AI-kapcsolatok megtekintése',
  },
  aiConnectionRejected: {
    subject: 'AI-kapcsolat elutasítva',
    title: 'AI-kapcsolat elutasítva',
    greeting: 'Szia {name}!',
    body: 'A fiókodhoz tartozó AI-kapcsolat kérelmet elutasították.',
    agentLabel: 'Ügynök: {agent}',
    cta: 'AI-kapcsolatok megtekintése',
  },
  testEmail: {
    subject: 'Project Knowledge Hub — teszt e-mail',
    title: 'Teszt e-mail',
    greeting: 'Szia {name}!',
    body: 'Ez egy tesztüzenet a Project Knowledge Hubtól. Az e-mail küldés a lenti beállításokkal működik.',
    driverLabel: 'Illesztő: {driver}',
    sourceLabel: 'Konfig forrás: {source}',
    fromLabel: 'Feladó: {from}',
    cta: 'E-mail beállítások megnyitása',
  },
};

const catalogs: Record<AppLocale, MailMessages> = { en, de, hu };

export function getMailMessages(locale: AppLocale): MailMessages {
  return catalogs[locale] ?? catalogs.en;
}
