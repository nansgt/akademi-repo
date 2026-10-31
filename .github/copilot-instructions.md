# Copilot instructions

## Build, run, and validate

- Install PHP dependencies with `composer install`.
- The npm dependencies are only needed to rebuild bundled browser assets. Run `npm ci`, then `npm run build:pdf-assets` and/or `npm run build:docx-assets` when changing those libraries.
- Configure the required Compose variables in `.env` as described in [INSTALLATION.md](../INSTALLATION.md), then build and start the app and MariaDB with `docker compose up -d --build`. Apply schema changes inside the app container with `docker compose exec -T app php bin/migrate.php`.
- This Codespaces Compose setup publishes the app on port 8000. Check it with `curl -fsS http://127.0.0.1:8000/health`; use the forwarded port URL to open the app. View app logs with `docker compose logs -f app`.
- There is no configured automated test runner or JavaScript/PHP lint script. For a focused PHP syntax check, run `php -l path/to/file.php`. To syntax-check PHP files outside dependencies, run:

  ```sh
  find . -type d \( -name .git -o -name vendor -o -name node_modules \) -prune -o -type f -name '*.php' -print0 | xargs -0 -n1 php -l
  ```

- Use the manual end-to-end checks in [INSTALLATION.md](../INSTALLATION.md#basic-smoke-checks) when validating application behavior.

## Architecture

- This is a PHP 8.2+ and MySQL application with a single front controller. Root `index.php` loads `config/bootstrap.php` and then `app/Http/router.php`; the router normalizes paths, serves the workspace and API routes, and dispatches to services or PHP views. This is a lightweight MVC-style organization, not a framework: add routes to the central router and put domain logic in the existing service layer.
- `config/bootstrap.php` loads `.env`, configures private storage, sessions and logging, includes Composer autoloading, and maps the `Akademi\\` namespace to `app/`. `app/Database/Connection.php` provides the shared PDO connection.
- The signed-in workspace is an HTML shell in `index.html`, with client-side navigation and API interactions in `assets/app.js`; styles and focused browser behavior live in `assets/`. Admin-specific screens also use PHP views under `app/Views/`.
- Business operations live in `app/Services/` and use PDO through `Connection::get()`. The router is also the boundary for HTTP methods, authentication/role checks, CSRF verification, and JSON responses.
- Curriculum content follows an ingestion and review pipeline: `CurriculumIngestionService` imports source files and extracted text; review services manage provenance and verification; search and generation services use eligible curriculum material. Teacher-facing retrieval and AI drafting should continue to require enabled, verified sources. Extracted or AI-derived structure is not authoritative until reviewed.
- SQL schema changes are ordered files in `database/migrations/`. `bin/migrate.php` applies them by filename and records applied migrations; add a new numbered migration rather than editing one that may already have run elsewhere.

## Repository-specific conventions

- PHP files use `declare(strict_types=1)` and PSR-4 classes under the `Akademi\\` namespace. Keep domain logic in the relevant service instead of expanding route handlers.
- API handlers use `request_json()` for request bodies and `json_response()` for JSON output. Mutating API requests verify CSRF with `Csrf::verifyRequest()`; preserve the route’s authentication and role checks, and enforce account ownership in backend queries rather than relying on UI visibility.
- Keep secrets out of browser code and responses. Runtime configuration belongs in `.env` or the existing encrypted settings services; application data, logs, and sessions belong in `AKADEMI_STORAGE`, not public asset paths.
- Curriculum and assessment data has review, ownership, expiry, and history rules encoded across services, routes, migrations, and browser code. When changing one of these workflows, trace and update the related layers together; use [online-assessment-expiry.md](../docs/online-assessment-expiry.md) for documented assessment lifecycle behavior.
