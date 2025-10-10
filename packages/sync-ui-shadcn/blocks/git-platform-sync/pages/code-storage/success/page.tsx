'use client';

import { Button } from '@/components/ui/button';
import { CheckCircle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

const appInstallType = 'git-platform-sync-app-installed--github';

function SuccessPageContent() {
  const searchParams = useSearchParams();
  const installationId = searchParams.get('installation_id');
  const setupAction = searchParams.get('setup_action');
  const state = searchParams.get('state');

  useEffect(() => {
    if (window.opener != null) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      window.opener.postMessage(
        {
          type: appInstallType,
          installationId,
          setupAction,
          state,
        },
        window.opener.origin
      );

      setTimeout(() => {
        window.close();
      }, 2000);
    }
  }, [installationId, setupAction, state]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8">
        <div className="text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Installation Successful!
          </h1>
          <p className="text-gray-600 mb-6">
            Your GitHub App has been successfully{' '}
            {setupAction === 'install' ? 'installed' : 'updated'}.
          </p>
          {installationId != null && (
            <p className="text-sm text-gray-500 mb-6">
              Installation ID: {installationId}
            </p>
          )}
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              This window will close automatically…
            </p>
            <Button
              onClick={() => {
                if (window.opener != null) {
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                  window.opener.postMessage(
                    {
                      type: appInstallType,
                      installationId,
                      setupAction,
                      state,
                    },
                    window.opener.origin
                  );

                  setTimeout(() => {
                    window.close();
                  }, 0);
                } else {
                  window.location.href = '/';
                }
              }}
              className="w-full"
            >
              Close Window
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={null}>
      <SuccessPageContent />
    </Suspense>
  );
}
