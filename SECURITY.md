# Security

## Data flow

PSF runs entirely in your browser. Categorized transactions, rules, categories, and the OpenRouter key are written to the local folder you select. The browser remembers that folder handle in IndexedDB.

When categorizing, PSF sends only transaction `date`, `description`, `amount`, and the category list to OpenRouter. Raw PDF content, account labels, and bank identifiers are not sent by the OpenRouter client. OpenRouter processes requests under its own policies; review its current privacy and data-retention terms before using sensitive data.

## User responsibilities

- Treat the selected data folder and `settings.json` as sensitive. The API key is stored in plaintext on disk.
- Use full-disk encryption and OS access controls, especially on shared or portable devices.
- Do not upload or sync the data folder to an untrusted service.
- Use HTTPS for deployed instances and keep the hosting account and DNS protected.
- Rotate the OpenRouter key if the folder, browser profile, device, or deployed app may have been exposed.
- Keep backups encrypted and test restoring them.

## Scope and limitations

PSF does not provide authentication, authorization, server-side secret storage, audit logging, or automatic encryption of the data folder. A compromised device, browser profile, deployment, or dependency may access data available to the app.

## Reporting a vulnerability

Do not include financial data, API keys, or other secrets in an issue. Report security issues privately to the repository maintainer or security contact configured for this deployment. Include the affected version, reproduction steps, impact, and a safe way to contact you.

If no private security contact is configured, open a minimal issue asking for the maintainer's private reporting channel without disclosing exploit details.
