# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [1.1.0] - 2026-05-11

### Added
- Repository baseline docs: `README.md`, `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`, `.gitignore`.
- `docs/OPERATIONS.md` with local runbook, Supabase/SMTP requirements, deployment checks, and troubleshooting.

### Changed
- Sanitized `.env.example` to remove sensitive values and document required env variables for runtime, auth, and operations.

## [1.0.0] - 2026-05-11

### Added
- Initial website + waitlist API implementation (Express + static frontend + Supabase + SMTP + tests).
