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

```bash
npx scripttag-audit scan \
  --store my-store.myshopify.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET
```

(Not yet on npm? Clone and run locally: `npm install && npm run dev -- scan ...`.)

### Getting credentials (2026 Dev Dashboard flow)

Since Jan 2026, Shopify apps no longer have static `shpat_` tokens. Use the
client-credentials flow instead — the CLI mints a fresh ~24h token per run:

1. [dev.shopify.com](https://dev.shopify.com) → **Apps** → **Create app**
2. Create a version with the Admin API scope **`read_script_tags`**, then **Release**
3. **Install** the app on the store you want to audit
4. **Settings** → copy the **Client ID** and **Client secret**
5. Run the command above (legacy `--token shpat_...` from pre-2026 custom apps also works)

Only audit stores you own or are authorized to access.

## Flags

| Flag | Description | Default |
|---|---|---|
| `--store <domain>` | Shop domain (`my-store.myshopify.com`; the `.myshopify.com` suffix is optional) | required |
| `--token <token>` | Admin API access token | required |
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

- [ ] `advise` — per-tag scaffolding hints (theme app extension / web pixel skeletons)
- [ ] `login` — interactive OAuth flow (no manual token copy)
- [ ] Multi-store batch mode (see the TagGuard dashboard)

## License

MIT. Not affiliated with Shopify. Use on stores you own or are authorized to access.
