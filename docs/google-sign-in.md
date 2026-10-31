# Google sign-in setup

The login dialog supports Google through the existing Supabase project. Email/password login remains available. Google authentication does not grant admin access: `refreshAccount()` still validates the user and calls `is_admin`.

The public Auth settings reported Google disabled when this feature was added. A project owner must complete the provider configuration:

1. Create a Web application OAuth client in Google Cloud / Google Auth Platform, configuring its audience and branding. Use only `openid`, `email`, and `profile` scopes; Gmail inbox access is not needed.
2. Set the Google client's authorized redirect URI to `https://qxcgqljvalywtensfhwm.supabase.co/auth/v1/callback`.
3. In Supabase → Authentication → Sign In / Providers → Google, enable Google and enter the client ID and client secret. Store the secret there only, never in this repository or browser configuration.
4. In Supabase → Authentication → URL Configuration, allow `https://sequence-body-flight-academy.pages.dev/index.html`. Add any actual custom-domain callback URLs separately. Preview or local callbacks need their own explicitly allowed URLs.
5. Test with an existing administrator's matching, verified Google email. Verify the existing Supabase user identity is used and admin access remains intact. A Google account without an admin record must be denied.
6. Test cancellation, logout, and the existing email/password flow. A successful Google login must not change participant records or grant roles.

References:
- https://supabase.com/docs/guides/auth/social-sign-in/auth-google
- https://supabase.com/docs/guides/auth/redirect-urls

The button and redirect initiation can be tested locally. End-to-end Google login requires provider credentials, allowed callbacks, and the account owner completing Google's sign-in flow.
