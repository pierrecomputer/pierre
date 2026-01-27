import { NextResponse } from 'next/server';

type GitHubOAuthTokenResponse =
  | {
      access_token: string;
      token_type: 'bearer';
      scope: string;
    }
  | {
      error: string;
      error_description: string;
      error_uri: string;
    };

type AvailablePlatform = 'github';

type CodeStorageSuccessCallbackOptions = {
  clientId: string;
  clientSecret: string;
  platform: AvailablePlatform;
  redirectUrl?: string;
  env: 'production' | (string & {});
};

type NextRequestLike = {
  nextUrl: { searchParams: URLSearchParams };
  url: string;
};

export class CodeStorageSuccessCallback {
  private clientId: string;
  private clientSecret: string;
  private redirectUrl?: string;
  private env: 'production' | (string & {}) = 'production';

  constructor(options: CodeStorageSuccessCallbackOptions) {
    if (options.platform !== 'github') {
      throw new Error(
        // The error is intentionally outputting an unexpected value
        // oxlint-disable-next-line typescript/restrict-template-expressions
        `CodeStorageSuccessCallback Error: Invalid platform: ${options.platform}`
      );
    }
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.redirectUrl = options.redirectUrl;
    this.env = options.env;
  }

  private getParams(request: NextRequestLike) {
    const searchParams = request.nextUrl.searchParams;

    const code = searchParams.get('code') ?? null;
    const installationId = searchParams.get('installation_id') ?? null;
    const setupAction = searchParams.get('setup_action') ?? null;
    const state = searchParams.get('state') ?? null;

    if (code == null || code === '') {
      throw new Error('CodeStorageSuccessCallback Error: No code provided');
    } else if (installationId == null || installationId === '') {
      throw new Error(
        'CodeStorageSuccessCallback Error: No installation ID provided'
      );
    } else if (setupAction == null || setupAction === '') {
      throw new Error(
        'CodeStorageSuccessCallback Error: No setup action provided'
      );
    } else if (state == null || state === '') {
      throw new Error('CodeStorageSuccessCallback Error: No state provided');
    }

    return { code, installationId, setupAction, state };
  }

  private generateRedirectUrl(
    request: NextRequestLike,
    {
      installationId,
      setupAction,
      state,
    }: { installationId: string; setupAction?: string; state: string }
  ) {
    if (this.redirectUrl != null && this.redirectUrl !== '') {
      return this.redirectUrl;
    }

    const successUrl = new URL('/code-storage/success', request.url);

    if (setupAction != null && setupAction !== '') {
      successUrl.searchParams.set('setup_action', setupAction);
    }
    if (installationId != null && installationId !== '') {
      successUrl.searchParams.set('installation_id', installationId);
    }
    if (state != null && state !== '') {
      successUrl.searchParams.set('state', state);
    }
    return successUrl;
  }

  async handleRequest(request: NextRequestLike) {
    try {
      const { code, installationId, setupAction, state } =
        this.getParams(request);

      const tokenResponse = await fetch(
        'https://github.com/login/oauth/access_token',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: this.clientId,
            client_secret: this.clientSecret,
            code,
          }),
        }
      );

      const tokenData =
        (await tokenResponse.json()) as GitHubOAuthTokenResponse;

      if ('error' in tokenData) {
        throw new Error(
          tokenData.error_description ??
            tokenData.error ??
            'error fetching github token'
        );
      }

      const successUrl = this.generateRedirectUrl(request, {
        installationId,
        setupAction,
        state,
      });

      const response = NextResponse.redirect(successUrl);

      response.cookies.set('github_token', tokenData.access_token, {
        httpOnly: true,
        secure: this.env === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30,
      });

      return response;
    } catch (error) {
      console.error('CodeStorageSuccessCallback Error:', error);
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'CodeStorageSuccessCallback Error',
        },
        { status: 400 }
      );
    }
  }
}
