# xrp.bsvkey.com

The XRP-rail entry point for BSVKey, positioned within a rail-agnostic story:
verifiable, non-custodial, pay-per-call settlement for AI agents.

- **BSV** is live today (inference.bsvkey.com, paywall.bsvkey.com).
- **XRP Ledger** is the next rail, in development, with early access open. There
  is no working XRP settlement yet; this page states that honestly and gathers
  interest to decide build order.
- The verifiable-receipt layer is rail-neutral (shared content-addressed core;
  see [bsv-capacity-attest](https://github.com/EmbryoSpace/bsv-capacity-attest)).

## Contents

- `web/index.html`, the single static page (self-contained, theme-aware).

## Deploy

Static site on Netlify (site `bsvkey-xrp`, custom domain `xrp.bsvkey.com`).

```bash
netlify deploy --prod --dir web
```

A product of Embryo Space Inc. (DBA BSVKey).
