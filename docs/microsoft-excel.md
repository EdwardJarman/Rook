# Microsoft Excel integration

Rook connects to Microsoft 365 through the OAuth 2.0 authorization-code flow with PKCE. Tokens are stored server-side only and encrypted with AES-256-GCM.

## Microsoft Entra application

Create a multi-tenant app registration and add this Web redirect URI:

```text
https://www.rook.lighting/api/oauth/microsoft/callback
```

Configure these delegated Microsoft Graph permissions:

- `User.Read`
- `Files.ReadWrite`
- `offline_access`
- `openid`
- `profile`
- `email`

Create a client secret and configure the deployment environment:

```text
APP_ORIGIN=https://www.rook.lighting
MICROSOFT_CLIENT_ID=<application-client-id>
MICROSOFT_CLIENT_SECRET=<client-secret-value>
MICROSOFT_TENANT_ID=common
MICROSOFT_REDIRECT_URI=https://www.rook.lighting/api/oauth/microsoft/callback
INTEGRATION_ENCRYPTION_KEY=<32-random-bytes-as-base64>
ROOK_MOBILE_SCHEME=manusrook
```

## Supported operations

Connected users can list `.xlsx` workbooks from OneDrive and shared Microsoft 365 locations, inspect worksheets and tables, and read values, displayed text, and formulas from focused ranges. Rook can prepare four write operations: update a range, append rows to a named table, add a worksheet, and create a workbook.

Read operations may run directly when requested. Write operations are persisted as pending actions and execute only after the user presses **Approve** in Rook’s Updates screen. Pending actions expire after 24 hours.

## Security properties

- Access and refresh tokens never enter the Expo client or Bot prompt.
- Tokens are encrypted at rest with AES-256-GCM and a deployment-only key.
- OAuth state is single-use, expires after ten minutes, and is bound to the authenticated Rook user.
- PKCE is used in addition to the confidential client secret.
- OAuth returns are restricted to Rook production origins, local development, and the Rook mobile deep-link scheme.
- Workbook reads are capped at 2,500 cells per tool call.
- The model must discover real drive, workbook, worksheet, and table identifiers before acting.
- Disconnecting removes all Microsoft tokens, OAuth state, and pending Excel actions.
- Account deletion also removes all integration data.

## Database

The canonical data model is `instant.schema.ts`, and `instant.perms.ts` denies all client access. Microsoft connections, single-use OAuth states, and approval-gated Excel actions are read and written only by the Express backend through `@instantdb/admin`. The deployment must define `INSTANT_APP_ADMIN_TOKEN`; this secret must never be exposed through an `EXPO_PUBLIC_*` variable or committed to source control.
