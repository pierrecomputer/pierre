'use client';

import { CheckCircle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

import { Button } from '@/components/ui/button';

const appInstallType = 'git-platform-sync-app-installed--github';

function SuccessPageContent() {
  const searchParams = useSearchParams();
  const installationId = searchParams.get('installation_id');
  const setupAction = searchParams.get('setup_action');
  const state = searchParams.get('state');

  useEffect(() => {
    if (window.opener != null) {
      // oxlint-disable-next-line typescript/no-unsafe-call
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
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-lg">
        <div className="text-center">
          <CheckCircle className="mx-auto mb-4 h-16 w-16 text-green-500" />
          <h1 className="mb-2 text-2xl font-bold text-gray-900">
            Installation Successful!
          </h1>
          <p className="mb-6 text-gray-600">
            Your GitHub App has been successfully{' '}
            {setupAction === 'install' ? 'installed' : 'updated'}.
          </p>
          {installationId != null && (
            <p className="mb-6 text-sm text-gray-500">
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
                  // oxlint-disable-next-line typescript/no-unsafe-call
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
