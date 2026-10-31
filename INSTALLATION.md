# Akademi deployment and setup

Akademi is an in-progress Ghana SHS planning platform. This repository now contains a PHP 8.2+/MySQL foundation, passwordless email-code authentication, Super Admin AI settings, local curriculum text ingestion/review, verified-source retrieval, and AI draft endpoints. Do not treat it as a production-ready hosted service yet: see [Current limits](#current-limits) before deployment.

## Requirements

- PHP 8.2 or newer with `curl`, `mbstring`, `openssl`, `pdo_mysql`, and `fileinfo`. Enable PHP's `zip` extension while installing Composer packages.
- MySQL 8+ or a compatible MariaDB release with InnoDB and FULLTEXT support.
- Composer, for PHPMailer and PDF text extraction.
- Node.js and npm, only when rebuilding the bundled PDF.js or DOCX-renderer assets.
- Apache with `mod_rewrite` and `.htaccess` enabled, or a separately configured HTTPS web server.
- A working SMTP account for sign-in codes. An AI provider API key is optional until AI drafting or structure extraction is needed.

## Local XAMPP setup

1. Back up and inspect any existing XAMPP MySQL data before starting, changing, or reinitializing MariaDB. Do not point Akademi at a database that contains unrelated data.
2. Check available disk space. Do not initialize, reset, or repurpose an existing XAMPP MariaDB data directory; it may contain other projects. Use an isolated database instance/data directory for Akademi, or a dedicated database on an existing instance only after confirming it is safe to start and use.
   This workspace uses a separate MariaDB 10.4 data directory at `D:\AkademiData\mysql`, bound only to `127.0.0.1:3307`. Start that instance in its own PowerShell window with:

   ```powershell
   C:\xampp\mysql\bin\mysqld.exe --no-defaults --basedir="C:\xampp\mysql" --datadir="D:\AkademiData\mysql" --tmpdir="D:\AkademiData\tmp" --port=3307 --bind-address=127.0.0.1 --innodb-buffer-pool-size=256M --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci --console
   ```

   Do not start the existing XAMPP MariaDB data directory for this Akademi instance. Its database credentials and private storage configuration are in the ignored local `.env` file.
3. Install Composer and select `C:\xampp\php\php.exe` as its PHP executable. In PowerShell, from the project directory, run:

   ```powershell
   composer install
   ```

   If Composer cannot extract package archives, enable the bundled `extension=zip` in `C:\xampp\php\php.ini`, restart PHP/Apache as needed, and confirm `php -m` lists `zip`.

4. Create a dedicated empty database and a database user limited to that database. For a local-only database, for example:

   ```sql
   CREATE DATABASE akademi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'akademi_app'@'localhost' IDENTIFIED BY 'use-a-unique-local-password';
   GRANT ALL PRIVILEGES ON akademi.* TO 'akademi_app'@'localhost';
   ```

   Use a unique password and do not use MySQL's `root` account for a deployed application.

5. Copy `.env.example` to `.env`. Set `APP_URL`, the dedicated database credentials, and SMTP settings. Generate an application key with:

   ```powershell
   C:\xampp\php\php.exe bin\generate-app-key.php
   ```

   Put the printed value in `APP_KEY`. Set `AKADEMI_STORAGE` to a private writable directory outside `htdocs`, such as `C:\xampp\akademi-private-storage`. Keep `.env`, database backups, logs, and storage out of public web directories; never commit `.env`.

   If sign-in reports `APP_KEY must decode to exactly 32 bytes`, the running PHP process is reading a missing, placeholder, or malformed key. Check the private `.env` used by Apache/PHP and set `APP_KEY` to the complete `base64:...` value printed by the command above; do not paste the key into support requests or commit it. If this installation already has encrypted SMTP, AI-provider, OAuth, or assessment secrets, restore the original `APP_KEY` from its secure backup instead of generating a replacement. A new key cannot decrypt values encrypted with the old key. After restoring or configuring the key, restart Apache so PHP picks up the environment.

6. Apply the schema and provision the first Super Admin from a terminal:

   ```powershell
   C:\xampp\php\php.exe bin\migrate.php
   C:\xampp\php\php.exe bin\create-superadmin.php "Administrator Name" admin@example.com
   ```

   No default administrator is created. The provisioned administrator can sign in with a password or a one-time email code. Set up SMTP before relying on email-code sign-in.

   To provision a first local Super Admin password without SMTP, run `C:\xampp\php\php.exe bin\reset-superadmin-password.php admin@example.com`. It is CLI-only, local-environment-only, requires an active verified Super Admin, generates a random password shown once, and revokes that account's existing sessions. Save the password in a password manager and change it after signing in. Never use this recovery command in production.

   Existing accounts without a password can continue using email-code sign-in, then set a password from **Workspace profile → Manage password**. A recent successful email-code sign-in can also authorize a password change without the previous password. Users with a password can still use email-code sign-in as a recovery fallback.

7. Visit `http://localhost/www/shsPlannerAi/` for this XAMPP installation. The configured `APP_URL` must match the URL you actually use. Without Apache, set `APP_URL` to your local PHP server origin, then run `C:\xampp\php\php.exe -S 127.0.0.1:8080 -t . index.php` from the project directory and visit `http://127.0.0.1:8080/login`. Before any public deployment, configure HTTPS and secure cookies, a least-privilege database account, restricted filesystem permissions, production SMTP, database backups, and a deployment-specific `APP_KEY` and private storage path.

## Configure email delivery

The initial SMTP connection can be bootstrapped from private `.env` values (`MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_ENCRYPTION`, `MAIL_FROM_ADDRESS`, and `MAIL_FROM_NAME`). After signing in, open **Platform settings → Email delivery** to manage these values in the Super Admin interface. Saved settings take precedence over `.env`; the SMTP password is encrypted in the database with `APP_KEY` and is never returned to the browser. Leave the password field blank to retain the stored password. Verification and test messages use the configured sender address for both the message From header and SMTP envelope sender. Use **Send test email** to send a message to the optional test-recipient address; if left blank, the recipient defaults to the configured sender address. The result confirms SMTP acceptance only, not delivery to the recipient's inbox. The settings page's setup-status checklist shows which required provider, sender, credit, or brand settings still need attention.

SMTP acceptance is not proof of inbox delivery. Configure the sending domain’s SPF and DKIM records with the mail provider’s exact DNS values, and publish a DMARC policy appropriate to the domain. Do not guess or publish multiple SPF records.

## Configure Google and Apple sign-in

After signing in as Super Admin, open **Platform settings → OAuth sign-in providers**. Provider secrets are encrypted in the database with `APP_KEY`; they are never returned to the browser. OAuth buttons stay hidden until a provider is fully configured and enabled.

- For Google, create a Web application OAuth client. Register the exact URL `https://your-domain.example/auth/oauth/google/callback` (including the app's installation subpath, if any) as an authorized redirect URI. Enter its client ID, client secret and that same callback URL in the settings page.
- For Apple, configure a Services ID and its verified domain/return URL in Apple Developer. Apple requires HTTPS. Enter the Services ID, the signed client-secret JWT, and the exact callback URL `https://your-domain.example/auth/oauth/apple/callback`. Generate the JWT with Apple's required team ID, key ID and `.p8` key in your own trusted environment; store only the JWT in Akademi, never the `.p8` private key. Refresh the JWT before it expires.

Both flows use one-time server-stored state and nonce values, validate the provider's signed ID token and verified email, and associate the provider subject with an Akademi account. OAuth can sign into an existing account only when that account is active and its email was already verified. Suspended accounts are not reactivated by OAuth.

## Configure AI

Sign in as Super Admin and open **Platform settings**. Select a provider, enter its API key, save, and use the connection test. Akademi selects a default model for each provider automatically. Supported adapters are xAI/Grok, OpenAI, OpenRouter, and Groq. Groq provides an OpenAI-compatible API and has a no-cost developer tier subject to account-specific limits and billing terms; create a key at [Groq Console](https://console.groq.com/keys). Keys are encrypted in the database using `APP_KEY` and are not returned to the browser. The settings page indicates whether the selected provider has a free tier, is paid, or has model-dependent pricing; confirm actual billing in the provider account.

Provider availability, model access, rate limits, and pricing depend on the provider account and can change. OpenRouter models marked with the `:free` suffix are identified as free, while other OpenRouter model prices vary. The teacher workspace sends the request and retrieved verified curriculum excerpts to the configured third party when **Generate with AI** is used. Review the provider's privacy, retention, and data-processing terms; do not include identifiable learner data or confidential information.

Super Admins can use the **Brand & theme** settings tab to update the shared primary and secondary brand colors. Every app page loads the saved palette; each user can independently toggle light or dark mode, with that preference stored in the browser.

If a teacher does not receive a verification email, check the destination address and spam folder, then use **Use a one-time email code instead** on the sign-in page with the same address. This also sends a registration-verification code to an account that is still pending. SMTP acceptance confirms that the mail server accepted the message; it does not guarantee final inbox placement.

## Import and review supplied curriculum files

Super Admins can upload up to 10 PDF, DOCX, TXT, MD or CSV files at a time from **Curriculum library**. The combined upload limit is 80 MB. The included `.user.ini` sets PHP `upload_max_filesize=80M`, `post_max_size=82M`, `max_file_uploads=10` and `memory_limit=768M` for CGI/FastCGI hosts; `.htaccess` applies the same limits when Apache runs PHP as a module. PDF extraction uses a bounded decoded-stream memory limit and disables retention of image data. PHP may take up to five minutes to refresh per-directory `.user.ini` settings. If uploads are still rejected before reaching the app, configure the hosting proxy/web server to accept request bodies of at least 82 MB. DOCX extraction requires PHP DOM and zlib; `ZipArchive` is not required. Uploads are stored outside the public web root under `AKADEMI_STORAGE/curriculum/uploads` with private file permissions; extracted uploads remain unverified until reviewed. Image-only PDFs are flagged for OCR, which the app does not provide.

The administrator resource library renders PDF first-page cover previews and both administrator and teacher readers render the original PDF pages in an in-app viewer using locally bundled PDF.js files. The reader supports page-by-page navigation (including horizontal swipes on touch screens) and continuous vertical scrolling with nearby pages rendered on demand, plus zoom, fit-to-width, and PDF download controls. Its application chrome follows the selected light or dark theme while preserving each PDF page's original appearance. PDF.js files are already included in the application assets; to refresh them after changing the pinned `pdfjs-dist` dependency, run `npm install` and `npm run build:pdf-assets`.

DOCX resources are rendered from the uploaded Word file in both the administrator preview and teacher reader, preserving Word structure such as tables, page breaks, and formatting more faithfully than extracted-text reconstruction. Browser rendering can differ slightly from Microsoft Word; downloading the original DOCX retains the exact uploaded file. The DOCX preview libraries are bundled locally; after changing the pinned `docx-preview` dependency, run `npm install` and `npm run build:docx-assets`. The teacher workspace and curriculum-review page allow inline styles because the DOCX renderer uses document-specific CSS; scripts remain restricted to same-origin files.

To supply a scheme-of-work template, choose **Scheme of work template** as the resource type, then verify the uploaded resource. Verified templates guide document structure and headings only; they do not establish curriculum facts or official approval.

The importer references original files in place; it does not copy them. First run a scan-only inventory:

```powershell
C:\xampp\php\php.exe bin\scan-curriculum.php "C:\Users\king\Downloads\curricullum_resources" --scan-only
```

Check the inferred year group and resource role for each filename. Unknown or incorrectly classified resources must be corrected by a human before relying on them. The importer supports PDF, text, Markdown, and CSV files up to 80 MB each. PDF text extraction requires the Composer-installed `smalot/pdfparser` package; image-only scans are marked as needing OCR, which is not provided by this application.

After reviewing the scan output, import from the CLI by omitting `--scan-only`:

```powershell
C:\xampp\php\php.exe bin\scan-curriculum.php "C:\Users\king\Downloads\curricullum_resources"
```

This reads every supported file below the supplied directory. Test with a small, separate sample folder first. It records relative source paths, hashes, extracted page chunks, and ingestion results in the configured database; original PDFs remain where they are. Keep those source files available at the same relative location for future reference.

If a previous import was interrupted or marked a document as failed, rerun with `--retry-incomplete`. The importer releases per-document parser memory between files and records fatal extraction interruptions where PHP can run its shutdown handler. Large or unusually complex PDFs may still need more PHP memory or OCR; inspect their status instead of treating an incomplete import as verified.

In **Curriculum review**, a Super Admin must independently check a document, provide its source/version reference and review notes, and mark it verified before retrieval can use its text. AI-extracted strands, sub-strands, focal areas, sections, standards, indicators, and topics are stored as unverified entries. AI structure extraction sends the selected excerpts to the configured provider. Review the original page and add notes before verifying each entry. Verification is an administrative review record, not an automatic NaCCA endorsement.

Super Admins can use **Read full resource** in Curriculum review to read original PDF pages in the in-app PDF viewer and open or download the privately stored source, including before verification. Text-based non-PDF resources are shown as paginated extracted text. In the teacher workspace, **Curriculum resources** lists only enabled, verified documents; teachers can search and filter by SHS year, read PDFs or extracted text, and download the original file. The teacher-facing list, reader, and source endpoints enforce verification and enabled status even when requested directly.

The assessment builder creates new practice drafts from reviewed curriculum material. It does not scrape, import, or reproduce NaCCA or WAEC question-bank/past-paper text. Import and use such questions only when you have explicit reuse rights or an authorized API/license; otherwise link teachers to the official source.

The Ministry of Education's curriculum resource hub and year pages are linked from the workspace:

- <https://curriculumresources.edu.gh/>
- <https://curriculumresources.edu.gh/year1/>
- <https://curriculumresources.edu.gh/year2/>
- <https://curriculumresources.edu.gh/year3/>

## Current limits

- Workspace profiles, saved draft previews, and teaching schedules are stored in the server database and scoped to the signed-in account. The downloadable backup is client-generated; automated off-site database backups still need to be configured by the operator.
- Generated AI lesson, assessment, scheme and slide drafts use reviewed curriculum excerpts, cost fixed credits per successful request, and require teacher review. Assessment questions are original practice drafts, not official NaCCA/WAEC past-paper questions.
- The upload flow and local CLI importer do not provide OCR or automated NaCCA catalog synchronization. Uploaded or imported files are not guaranteed to be official or correctly classified.
- The workspace sidebar can be collapsed on desktop; its preference is stored in the current browser. Interface icons use a local Font Awesome Free SVG sprite; its CC BY 4.0 attribution is included in `assets/icons.svg`.
- Generated structure remains source-derived, not authoritative curriculum. Weekly scheme autofill can use deterministic lesson entries from an enabled, text-extracted resource after the source document is verified; assessment modes are matched to week topics when source tables identify the indicator, with clearly marked formative suggestions as a fallback. The scheme builder derives each semester's teaching-week span from that subject's verified weekly allocations, then adds mid-semester examination, revision, and end-of-semester examination weeks. When weekly allocations are unavailable, it labels a provisional 12-week starting point. Teachers enter the first teaching date for each selected semester; week-ending dates are then calculated and remain editable. Other curriculum-grounded retrieval continues to follow its section/entry verification rules.
- Scheme documents visually distinguish examination and revision weeks, separate semesters in full-year layouts, and include prepared-by teacher and HOD review signature/date lines. The teacher name is taken from the signed-in profile; the HOD name is entered when creating the scheme and is included in saved and exported documents. Names alone do not indicate that a document has been signed or approved.
- There is no student quiz delivery, grading/gradebook, payments, referral program, public Super Admin management UI, or tested multi-node/session infrastructure.
- The schema migrations, account-scoped workspace/credit operations, SMTP authentication, and encrypted mail-setting storage have been smoke-tested against the isolated local MariaDB instance. End-to-end inbox delivery, xAI connectivity, document/structure review in an authenticated browser session, and production deployment controls still need testing before accepting real accounts or relying on AI output.
- Security controls in the code are a starting foundation, not a substitute for an independent security review, threat model, privacy/legal review, operational monitoring, incident response, and load testing.

## Basic smoke checks

1. Confirm the health endpoint returns `{"status":"ok"}` and an unprovisioned address cannot sign in.
2. Provision a Super Admin, verify an email code, sign out, and sign in again; check that SMTP codes expire and invalid attempts are rejected.
3. Configure an AI provider and test its connection. Generate a draft only after at least one matching curriculum document has been verified; check the displayed source and page citations.
4. Import a small sample folder, verify document provenance, and extract structure. Structure extraction is deterministic and does not call the configured AI provider: it recognizes explicitly labelled fields (for example, `Strand:`, numbered `Focal Area:` labels, `Content Standard:`, `Learning Indicator:`, and week/topic tables), including topic text wrapped across extracted lines and focal-area headings that continue across adjacent pages. It also reads indicator-linked `Assessment Mode:` rows and associates matching modes with weekly topics. It preserves the complete extracted text separately and does not infer missing curriculum details. Weekly scheme autofill uses these source-derived lessons from enabled resources whose source documents are verified; subject matching uses the selected subject metadata or normalized subject words anywhere in the filename, so it is not tied to one subject or filename prefix. The scheme builder inserts the three standard examination/revision weeks per semester and provides an explicitly marked formative-check suggestion when a source does not specify a weekly assessment mode. Other generated structure still follows its section/entry verification rules. Scanned PDFs still require OCR, and resources using different labels or layouts may need manual review.
5. Create drafts and schedule entries as two accounts on different browsers/devices; confirm each sees only its own server-synchronized workspace. Exercise credit exhaustion, failed-request refunds, and the Super Admin monthly-allowance update.
