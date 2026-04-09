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
- `OPENAI_USE_AZURE_API_KEY_AUTH` when using Azure OpenAI key auth

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
- `OPENAI_USE_AZURE_API_KEY_AUTH`
- `DAILY_BRIEFING_SCHEDULE`
- `ENABLE_SCHEDULED_BRIEFING`

Optional:

- `OPENAI_API_VERSION`
- `BRIEFING_STORAGE_FILE`
- `BRIEFING_STORAGE_PROVIDER`
- `BRIEFING_STORAGE_CONNECTION_STRING`
- `BRIEFING_STORAGE_CONTAINER`
- `BRIEFING_STORAGE_BLOB_NAME`
- `BRIEFING_EMAIL_ENABLED`
- `BRIEFING_EMAIL_CONNECTION_STRING`
- `BRIEFING_EMAIL_SENDER`
- `BRIEFING_EMAIL_RECIPIENTS`
- `BRIEFING_EMAIL_SUBJECT_PREFIX`
- `MORNING_EMAIL_SCHEDULE`
- `AFTERNOON_EMAIL_SCHEDULE`
- Any future database connection string such as `DATABASE_CONNECTION_STRING`

If `OPENAI_BASE_URL` ends with `/openai/v1`, the backend treats it as the Azure/OpenAI v1 endpoint and does not append `api-version` to the request URL, even if `OPENAI_API_VERSION` is set.

## Azure Key Vault

For production, store secrets in Azure Key Vault and reference them from Function App settings.

Typical Key Vault reference format:

`@Microsoft.KeyVault(SecretUri=https://<your-vault-name>.vault.azure.net/secrets/<secret-name>/<secret-version>)`

Recommended Key Vault-managed settings:

- `OPENAI_API_KEY`
- `BRIEFING_STORAGE_CONNECTION_STRING`
- `BRIEFING_EMAIL_CONNECTION_STRING`
- `DATABASE_CONNECTION_STRING`
- Any future API keys, signing keys, or storage credentials

Non-secret values such as `OPENAI_MODEL` or `DAILY_BRIEFING_SCHEDULE` can remain normal app settings unless you prefer to centralize them too.
