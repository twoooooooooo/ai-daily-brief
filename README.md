# AI Briefing Desk

## Local development

Run the frontend with Vite and the Azure Functions app separately during local development.

- Frontend: `npm run dev`
- Functions: `cd api && npm install && npm run build && func start`

The frontend uses `/api` by default and Vite proxies that path to the local Functions host at `http://127.0.0.1:7071`, so no browser CORS setup is needed for the normal local workflow.

If you want to emulate Azure Static Web Apps routing locally, you can also use the SWA CLI config in [swa-cli.config.json](/Users/tw/Downloads/AI%20Briefing%20Desk/swa-cli.config.json).

## Environment configuration

- `VITE_FUNCTIONS_ORIGIN`
  Used by the Vite dev server proxy.
  Default: `http://127.0.0.1:7071`

- `VITE_API_BASE_URL`
  Optional override for the frontend API base URL.
  Leave this unset for normal local development and Azure Static Web Apps deployment.

- `VITE_DEV_HOST`
  Optional host override for the Vite dev server.
  Default: `127.0.0.1`

- `VITE_ADMIN_API_KEY`
  Optional local-development key used by the dev-only admin panel when calling protected admin Functions endpoints.

- `VITE_ENABLE_DEV_PANEL`
  Optional toggle for the dev-only testing panel.
  Default: `true` in local development when unset.

An example frontend env file is included at [.env.example](/Users/tw/Downloads/AI%20Briefing%20Desk/.env.example).

Backend configuration details are documented in [api/CONFIGURATION.md](/Users/tw/Downloads/AI%20Briefing%20Desk/api/CONFIGURATION.md).

## Azure deployment

### Frontend: Azure Static Web Apps

- The SPA fallback and `/api` routing are configured in [staticwebapp.config.json](/Users/tw/Downloads/AI%20Briefing%20Desk/staticwebapp.config.json).
- The frontend should keep `VITE_API_BASE_URL` unset in Azure Static Web Apps so requests stay relative to `/api`.
- Build output is `dist/`.

### Backend: Azure Functions

- The Functions app lives in [api](/Users/tw/Downloads/AI%20Briefing%20Desk/api).
- Build command: `npm run build`
- Start command for local testing: `npm run start`
- Local-only files are excluded from deployment via [api/.funcignore](/Users/tw/Downloads/AI%20Briefing%20Desk/api/.funcignore).
- Local settings should stay in `api/local.settings.json`; Azure production settings should be configured as Function App application settings or Key Vault references instead.

### Recommended Azure app settings

For the Functions app, configure these in Azure:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `ADMIN_API_KEY`
- `REQUIRE_ADMIN_API_AUTH`
- `DAILY_BRIEFING_SCHEDULE`
- `ENABLE_SCHEDULED_BRIEFING`
- `BRIEFING_STORAGE_FILE` only if you intentionally want a custom filesystem path
- Future database secrets should also be stored as app settings or Key Vault references, not in source code

### Secrets management

- Do not commit real secrets in `local.settings.json`, `.env`, or any source file.
- Use [api/local.settings.sample.json](/Users/tw/Downloads/AI%20Briefing%20Desk/api/local.settings.sample.json) as the local template only.
- In Azure, prefer Key Vault references for secrets such as `OPENAI_API_KEY`, `ADMIN_API_KEY`, and any future database connection strings.
- In production, admin endpoints should have `ADMIN_API_KEY` configured. The backend now denies admin/test operations automatically in production-style environments when no admin key is configured.

For the frontend in Azure Static Web Apps:

- `VITE_API_BASE_URL` should usually be left unset
- Only set `VITE_API_BASE_URL` when the frontend needs to call a separately hosted API instead of the co-located `/api` route
