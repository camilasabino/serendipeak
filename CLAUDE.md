# SerendiPeak

New implementation of SerendiPeak. Behavioral parity with v1 comes first.

## Rules

- Behavioral contract first. The reference is `serendipeak-legacy@v1-behavioral-freeze` (commit `f9a66deb2c0591a9c574fb4751b938b5863e6a1e`). When unsure, the frozen fixtures in `contracts/v1/` decide.
- `../serendipeak-legacy` is read-only. Never modify it.
- `contracts/v1/` is vendored byte for byte. Never edit it by hand. Change it only with `npm run contracts:sync`, and check it with `npm run contracts:verify`.
- The PostgreSQL/PostGIS database is the canonical catalog from M1b on. There is no YAML source of truth. No YAML catalog files in this repository.
- Backend: Django, Django REST Framework, GeoDjango. Frontend (from M0b): Next.js Pages Router, React, TypeScript.
- No speculative abstractions. Use the Django ORM directly. No repositories, service layers or libraries before a concrete need.
- New dependencies are announced and approved before installing.
- Do not commit or push unless explicitly asked. Commit messages: English, imperative, Conventional Commits, no AI attribution.
- Code, docs and commit messages in English. No comments inside code or config files. Rationale goes in README or docs.
- Work one milestone slice per session. Respect its scope and non-goals. Report scope questions instead of implementing opportunistically.
- Private planning files live in `docs/specs/` and stay out of Git through `.git/info/exclude`.

## Commands

From `services/api` (the `--env-file` flag reads the root `.env`):

- `uv sync`
- `uv run --env-file ../../.env python manage.py check`
- `uv run --env-file ../../.env python manage.py migrate`
- `uv run --env-file ../../.env pytest`
- `uv run ruff format --check .` and `uv run ruff check .`

From the root:

- `docker compose up -d --wait` starts PostGIS on port 5434 (project `serendipeak-v2`). The legacy database uses 5433; never touch its containers.
- `npm run contracts:verify`
