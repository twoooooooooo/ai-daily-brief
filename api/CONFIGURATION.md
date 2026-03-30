# Backend Configuration

## Principles

- Keep secrets out of source control.
- Use environment variables for all sensitive backend configuration.
- For Azure, prefer Function App Application Settings or Key Vault references.

## Local development

Use [local.settings.sample.json](/Users/tw/Downloads/AI%20Briefing%20Desk/api/local.settings.sample.json) as the template for a private local `local.settings.json`.

Required local values:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`

Operational values:

- `AzureWebJobsStorage`
- `FUNCTIONS_WORKER_RUNTIME`
- `DAILY_BRIEFING_SCHEDULE`
- `ENABLE_SCHEDULED_BRIEFING`
- `BRIEFING_STORAGE_FILE`

`local.settings.json` should stay local only and must not be committed.

## Azure Functions Application Settings

Set these as Function App Application Settings in Azure:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `DAILY_BRIEFING_SCHEDULE`
- `ENABLE_SCHEDULED_BRIEFING`

Optional:

- `BRIEFING_STORAGE_FILE`
- Any future database connection string such as `DATABASE_CONNECTION_STRING`

## Azure Key Vault

For production, store secrets in Azure Key Vault and reference them from Function App settings.

Typical Key Vault reference format:

`@Microsoft.KeyVault(SecretUri=https://<your-vault-name>.vault.azure.net/secrets/<secret-name>/<secret-version>)`

Recommended Key Vault-managed settings:

- `OPENAI_API_KEY`
- `DATABASE_CONNECTION_STRING`
- Any future API keys, signing keys, or storage credentials

Non-secret values such as `OPENAI_MODEL` or `DAILY_BRIEFING_SCHEDULE` can remain normal app settings unless you prefer to centralize them too.
