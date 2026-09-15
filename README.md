# scripttag-audit

**Audit any Shopify store for script tags before Shopify kills them.**

> ⚠️ **Shopify is deprecating script tags.**
> - **2026-10-01** — `scriptTagCreate`/`scriptTagUpdate` start returning errors. Apps that still rely on script tags can no longer be installed on new stores.
> - **2027-03-01** — Shopify stops injecting script tags into storefronts entirely. Every remaining tag dies silently.
>
> Source: [official changelog](https://shopify.dev/changelog/online-store-script-tags-deprecation)

`scripttag-audit` lists every script tag on a store, classifies each one
(affected / already dead / unknown), guesses the vendor behind it, and tells
you what to migrate it to (web pixel vs app embed). Exit code `1` when
affected tags remain — so it doubles as a **CI gate** for your migration.

## Quick start

One-time OAuth login (no flag copying afterwards):

```bash
npx scripttag-audit login
# answers the prompts once, opens the browser for consent, done
npx scripttag-audit scan --store my-store.myshopify.com
```

Or fully manual in one shot:

```bash
npx scripttag-audit scan \
  --store my-store.myshopify.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET
```

(Not yet on npm? Clone and run locally: `npm install && npm run dev -- scan ...`.)

### Getting credentials (2026 Dev Dashboard flow)

Since Jan 2026, Shopify apps no longer have static `shpat_` tokens. The CLI
mints a fresh ~24h token per run via the client-credentials grant:

1. [dev.shopify.com](https://dev.shopify.com) → **Apps** → **Create app**
2. Create a version with the Admin API scope **`read_script_tags`**, then **Release**
3. **Install** the app on the store you want to audit
4. **Settings** → copy the **Client ID** and **Client secret**

For `login`, additionally whitelist the callback URL in your app config
(**Configuration → Allowed redirection URL**):

```
http://127.0.0.1:3739/callback
```

(use `login --port <n>` if 3739 is taken, then whitelist that port instead).

Saved credentials live in your user config directory — `%APPDATA%\scripttag-audit\credentials.json`
(Windows) or `~/.config/scripttag-audit/credentials.json` (macOS/Linux), never
in the repo, and `scan` re-mints tokens from them automatically when they
expire. Legacy `--token shpat_...` from pre-2026 custom apps still works.

Only audit stores you own or are authorized to access.

## Flags

| Flag | Description | Default |
|---|---|---|
| `--store <domain>` | Shop domain (`my-store.myshopify.com`; the `.myshopify.com` suffix is optional). Optional after `login` when exactly one store is saved | required |
| `--token <token>` | Admin API access token | — |
| `--client-id` / `--client-secret` | Dev Dashboard app credentials (or `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` env vars) | — |
| `--format <format>` | `table` \| `json` \| `csv` | `table` |
| `--api-version <version>` | Admin API version | `2026-07` |

## CI gate

```yaml
# .github/workflows/scripttag-gate.yml
- name: Fail if script tags remain
  run: |
    npx scripttag-audit scan \
      --store "$SHOP_DOMAIN" \
      --token "$SHOP_TOKEN" \
      --format table
  # exit code 1 while affected tags remain; 0 once the migration is done
```

## Advise — from audit to migration plan

Feed a JSON report back in to get a per-tag migration plan: who has to act
(vendor vs you), skeleton code for the web pixel / app embed migration, and
a ready-to-send `scriptTagDelete` mutation for already-dead tags:

```bash
npx scripttag-audit scan --store my-store --format json > report.json
npx scripttag-audit advise --report report.json           # human-readable plan
npx scripttag-audit advise --report report.json --format md   # paste into an issue
npx scripttag-audit advise --report report.json --email       # vendor inquiry emails
```

`advise` is offline (reads the report, not the store) and always exits 0 on
a valid report — use `scan` itself as the CI gate.

## What the report tells you

| Status | Meaning |
|---|---|
| `AFFECTED` | Storefront script tag. Stops running **2027-03-01**; new installs already break after **2026-10-01**. |
| `DEAD (cleanup)` | Order-status script tag from an earlier deprecation. Non-functional; safe to delete. |
| `UNKNOWN` | Unrecognized display scope — verify with the vendor. |

Migration hints follow Shopify's guidance:

- **Analytics / tracking style** → [web pixel](https://shopify.dev/docs/apps/build/online-store) (no merchant action needed)
- **Visible features (chat, popups, reviews...)** → app embed block in a theme app extension (merchants must activate it per theme)
- `scriptTags` queries and `scriptTagDelete` keep working after the deadlines — auditing and cleanup are the officially supported path.

## Contributing vendor mappings

Vendor identification uses a small CSV of `src` hosts. If a host in your
audit is unattributed or wrong, PRs are welcome: edit
[`assets/vendor-mapping.csv`](assets/vendor-mapping.csv) (or its upstream at
`research/vendor-mapping.csv` in the monorepo) and add the host → vendor pair.

## Roadmap

- [x] `advise` — per-tag migration plan + scaffolding hints + vendor emails
- [x] `login` / `logout` — interactive OAuth flow, no manual token copying
- [ ] Multi-store batch mode (see the TagGuard dashboard)

## License

MIT. Not affiliated with Shopify. Use on stores you own or are authorized to access.
