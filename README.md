# scripttag-audit

**Audit any Shopify store for script tags before Shopify kills them.**

> ⚠️ **Shopify is deprecating script tags.**
> - **2026-10-01** — `scriptTagCreate`/`scriptTagUpdate` start returning errors. Apps that still rely on script tags can no longer be installed on new stores.
> - **2027-03-01** — Shopify stops injecting script tags into storefronts entirely. Every remaining tag dies silently.
>
> Source: [official changelog](https://shopify.dev/changelog/online-store-script-tags-deprecation)

> **Prefer a UI?** TagGuard is also a free Shopify app — install it from the
> [Shopify App Store](https://apps.shopify.com/tagguard) and scan from the admin.

`scripttag-audit` audits both surfaces that matter at the deprecation: the
**live storefront HTML** (the only place tags injected by other apps are
visible) and the **active theme's liquid files** (hard-coded scripts). It
classifies each script (affected / already dead / unknown / theme-embedded /
app embed), guesses the vendor, and tells you what to migrate it to (web pixel
vs app embed). Exit code `1` when affected tags remain — so it doubles as a
**CI gate** for your migration.

The storefront scan requires **no credentials** — point it at any public
Shopify store:

```bash
npx scripttag-audit scan --store my-store.com --storefront-only
```

That is the key difference from the Admin API: the `scriptTags` query only
returns tags created by the calling app, so a third-party auditor cannot see
other apps' tags through the API. The rendered storefront HTML can.

**v0.4.0 — storefront HTML scan.** The `scriptTags` query is scoped to the app
that created the tag, so a third-party auditor cannot see other apps' tags
through the API. The CLI now also fetches the public storefront HTML, extracts
absolute `<script src>` URLs, drops Shopify first-party assets and same-site
subdomains, and reports the rest as `affected` (likely ScriptTag-injected) or
`app embed` (theme app extension asset, keeps running). This surface needs no
credentials: `npx scripttag-audit scan --store my-store.com --storefront-only`.
With `login`, the report also adds active-theme liquid files, ScriptTag API
records, and the ON/OFF state of app embeds. `login` now hides the
client-secret prompt (prints `*`) and accepts it via `SHOPIFY_CLIENT_SECRET`
or `--client-secret-stdin`, so recorded terminals never echo it.

**v0.3.0 — theme-file scan.** `scriptTags` queries only return tags created
by the calling app, and since 2026-10-01 `scriptTagCreate` fails on every API
version — so scripts added by merchants/agencies live in theme liquid files
that the ScriptTag API never sees. The scan therefore also reads the active
theme's `.liquid` files and reports hard-coded third-party `<script src>` as
`THEME` rows (with the file they were found in). Theme scripts are **not**
affected by the deprecation — only API-injected tags stop running. This needs
the **`read_themes`** scope in addition to `read_script_tags`; profiles
created before v0.3.0 should re-run `login`.

## Quick start

### Storefront-only (no credentials)

```bash
npx scripttag-audit scan --store my-store.com --storefront-only
```

### Full audit (adds theme files, ScriptTag API records, app embeds)

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
2. Create a version with the Admin API scopes **`read_script_tags`** + **`read_themes`**, then **Release**
3. **Install** the app on the store you want to audit
4. **Settings** → copy the **Client ID** and **Client secret**

For `login`, additionally whitelist the callback URL in your app config
(**Configuration → Allowed redirection URL**):

```
http://127.0.0.1:3739/callback
```

(use `login --port <n>` if 3739 is taken, then whitelist that port instead).

The client-secret prompt is **hidden** (prints `*`, never echoes the value).
For CI or recorded terminals, pipe it instead of typing:

```bash
npx scripttag-audit login --client-secret-stdin < secret.txt
# or: SHOPIFY_CLIENT_SECRET=... npx scripttag-audit login
```

Saved credentials live in your user config directory — `%APPDATA%\scripttag-audit\credentials.json`
(Windows) or `~/.config/scripttag-audit/credentials.json` (macOS/Linux), never
in the repo, and `scan` re-mints tokens from them automatically when they
expire. Legacy `--token shpat_...` from pre-2026 custom apps still works.

> **Partial scans are labelled, not silent.** If a client-credentials token
> cannot read themes (or the storefront is password-protected / bot-protected),
> the command keeps the surfaces it can read and prints `note:` lines. Use
> `scripttag-audit login` (OAuth) if you need theme files and app embeds, or
> re-authorize the store with the `read_themes` scope.

Only audit stores you own or are authorized to access.

## Flags

| Flag | Description | Default |
|---|---|---|
| `--store <domain>` | Shop domain (`my-store.myshopify.com`; the `.myshopify.com` suffix is optional). Optional after `login` when exactly one store is saved | required |
| `--token <token>` | Admin API access token | — |
| `--client-id` / `--client-secret` | Dev Dashboard app credentials (or `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` env vars) | — |
| `--storefront-only` | Skip theme/API/app-embed surfaces and scan only the public storefront HTML (no credentials needed) | off |
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
| `THEME (embed)` | Hard-coded `<script src>` in a theme `.liquid` file (with the file it was found in). **Not** affected by the deprecation — but updates require theme edits; ask the vendor for an app embed. |

Migration hints follow Shopify's guidance:

- **Analytics / tracking style** → [web pixel](https://shopify.dev/docs/apps/build/marketing-analytics/build-web-pixel) (no merchant action needed)
- **Visible features (chat, popups, reviews...)** → app embed block in a [theme app extension](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions) (merchants must activate it per theme)
- **Theme-embedded scripts** → keeps running; optionally ask the vendor for an app embed so updates stop requiring theme edits
- `scriptTags` queries and `scriptTagDelete` keep working after the deadlines — auditing and cleanup are the officially supported path.

## Contributing vendor mappings

Vendor identification uses a small CSV of `src` hosts. If a host in your
audit is unattributed or wrong, PRs are welcome: edit
[`assets/vendor-mapping.csv`](assets/vendor-mapping.csv) (or its upstream at
`research/vendor-mapping.csv` in the monorepo) and add the host → vendor pair.

## Roadmap

- [x] `advise` — per-tag migration plan + scaffolding hints + vendor emails
- [x] `login` / `logout` — interactive OAuth flow, no manual token copying
- [x] Theme-file scan (v0.3.0) — hard-coded `<script src>` in `.liquid`, the surface `scriptTags` can't see
- [ ] Multi-store batch mode (see the TagGuard dashboard)

## License

MIT. Not affiliated with Shopify. Use on stores you own or are authorized to access.
