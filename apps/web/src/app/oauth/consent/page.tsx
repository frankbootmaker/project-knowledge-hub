import { Suspense } from 'react';
import { OauthConsentForm } from '../../../components/oauth/OauthConsentForm';

export default function OauthConsentPage() {
  return (
    <Suspense fallback={null}>
      <OauthConsentForm />
    </Suspense>
  );
}
