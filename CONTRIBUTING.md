# Contributing to wattProtocol

Thanks for contributing to WATT Protocol's website and waitlist operations stack.

## Before you start

- Read `README.md` and `docs/OPERATIONS.md`.
- Copy `.env.example` to `.env` and configure local secrets.
- Never commit `.env`, credentials, or API keys.

## Development workflow

1. Create a branch from `main`.
2. Make focused changes with clear intent.
3. Run:
   - `npm test`
   - basic local verification via `npm run dev`
4. Open a pull request with:
   - summary of why the change is needed
   - test evidence
   - any operational impact (env vars, Supabase schema, SMTP behavior)

## Coding standards

- Keep Node runtime compatibility with current dependency constraints.
- Preserve security-focused behavior in auth/session/email flows.
- Maintain consistent UX and messaging around renewable utility, ESG impact, and transparency.
- Prefer explicit error handling for operational endpoints.

## Security-sensitive areas

Changes touching these areas require extra review:
- auth/session routes
- admin endpoints
- email sending logic
- Supabase writes and role usage

If you find a vulnerability, follow `SECURITY.md` instead of opening a public issue.
