<?php
declare(strict_types=1);

?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="app-base-path" content="<?= e(app_base_path()) ?>">
  <meta name="csrf-token" content="<?= e(\Akademi\Security\Csrf::token()) ?>">
  <link rel="icon" href="<?= e(app_url('assets/icon.svg')) ?>" type="image/svg+xml">
  <link rel="stylesheet" href="<?= e(app_url('assets/fontawesome/css/fontawesome.min.css')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/fontawesome/css/solid.min.css')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/action-icons.css')) ?>">
  <script src="<?= e(app_url('assets/action-icons.js?v=1')) ?>" defer></script>
  <link rel="stylesheet" href="<?= e(app_url('assets/styles.css?v=150')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/notifications.css?v=20')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/auth.css?v=23')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/appearance.css?v=5')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/admin-settings.css?v=6')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/ai-assistant.css?v=2')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/progress.css?v=5')) ?>">
  <title>AI provider settings · Akademi</title>
</head>
<body>
  <div class="app-shell">
    <?php $adminActive = 'settings'; require __DIR__ . '/admin-sidebar.php'; ?>
    <main class="main-area admin-settings-main">
      <header class="topbar">
        <button class="mobile-menu" id="mobile-menu" type="button" aria-label="Open navigation" aria-expanded="false"><svg class="icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-bars"></use></svg></button>
        <div class="breadcrumb"><span>Platform admin</span><span class="crumb-slash">/</span><strong>Platform settings</strong></div>
        <div class="topbar-actions"><span class="local-badge"><span class="status-dot"></span>Super Admin</span><button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch to dark mode" title="Switch to dark mode"></button></div>
      </header>
      <div class="page-container admin-settings-container">
    <section class="auth-card settings-card">
      <span class="auth-kicker">PLATFORM CONFIGURATION</span>
      <h1>Platform settings</h1>
      <p class="auth-lead">Manage your AI, email, sign-in and teacher credit settings here.</p>
      <div id="settings-alert" class="auth-alert hidden" role="status"></div>
      <button id="setup-status-trigger" class="setup-status-trigger" type="button" aria-haspopup="dialog" aria-controls="setup-status-dialog" aria-label="Open setup status">
        <span class="setup-status-indicator" aria-hidden="true"></span><span id="setup-status-label" aria-live="polite">Checking setup status…</span>
      </button>
      <dialog id="setup-status-dialog" class="setup-status-dialog" aria-labelledby="setup-status-title">
        <div class="setup-status-dialog-header">
          <div><span class="auth-kicker">PLATFORM HEALTH</span><h2 id="setup-status-title">Setup status</h2><p>Review required configuration and optional sign-in providers.</p></div>
          <button class="setup-status-close" type="button" aria-label="Close setup status" data-close-setup-status>&times;</button>
        </div>
        <section id="settings-status" class="settings-status" aria-live="polite">
          <p>Checking the platform configuration…</p>
        </section>
      </dialog>
      <!-- Font Awesome Free 6.7.2 icons by Fonticons, Inc., licensed under CC BY 4.0. -->
      <div class="settings-tabs" role="tablist" aria-label="Platform settings sections">
        <button class="settings-tab active" type="button" id="tab-ai" role="tab" aria-selected="true" aria-controls="panel-ai" data-tab="ai"><svg class="fa-icon" aria-hidden="true" viewBox="0 0 512 512"><path d="M184 0c30.9 0 56 25.1 56 56l0 400c0 30.9-25.1 56-56 56c-28.9 0-52.7-21.9-55.7-50.1c-5.2 1.4-10.7 2.1-16.3 2.1c-35.3 0-64-28.7-64-64c0-7.4 1.3-14.6 3.6-21.2C21.4 367.4 0 338.2 0 304c0-31.9 18.7-59.5 45.8-72.3C37.1 220.8 32 207 32 192c0-30.7 21.6-56.3 50.4-62.6C80.8 123.9 80 118 80 112c0-29.9 20.6-55.1 48.3-62.1C131.3 21.9 155.1 0 184 0zM328 0c28.9 0 52.6 21.9 55.7 49.9c27.8 7 48.3 32.1 48.3 62.1c0 6-.8 11.9-2.4 17.4c28.8 6.2 50.4 31.9 50.4 62.6c0 15-5.1 28.8-13.8 39.7C493.3 244.5 512 272.1 512 304c0 34.2-21.4 63.4-51.6 74.8c2.3 6.6 3.6 13.8 3.6 21.2c0 35.3-28.7 64-64 64c-5.6 0-11.1-.7-16.3-2.1c-3 28.2-26.8 50.1-55.7 50.1c-30.9 0-56-25.1-56-56l0-400c0-30.9 25.1-56 56-56z"/></svg>AI provider</button>
        <button class="settings-tab" type="button" id="tab-email" role="tab" aria-selected="false" aria-controls="panel-email" data-tab="email" tabindex="-1"><svg class="fa-icon" aria-hidden="true" viewBox="0 0 512 512"><path d="M48 64C21.5 64 0 85.5 0 112c0 15.1 7.1 29.3 19.2 38.4L236.8 313.6c11.4 8.5 27 8.5 38.4 0L492.8 150.4c12.1-9.1 19.2-23.3 19.2-38.4c0-26.5-21.5-48-48-48L48 64zM0 176L0 384c0 35.3 28.7 64 64 64l384 0c35.3 0 64-28.7 64-64l0-208L294.4 339.2c-22.8 17.1-54 17.1-76.8 0L0 176z"/></svg>Email delivery</button>
        <button class="settings-tab" type="button" id="tab-signin" role="tab" aria-selected="false" aria-controls="panel-signin" data-tab="signin" tabindex="-1"><svg class="fa-icon" aria-hidden="true" viewBox="0 0 640 512"><path d="M144 0a80 80 0 1 1 0 160A80 80 0 1 1 144 0zM512 0a80 80 0 1 1 0 160A80 80 0 1 1 512 0zM0 298.7C0 239.8 47.8 192 106.7 192l42.7 0c15.9 0 31 3.5 44.6 9.7c-1.3 7.2-1.9 14.7-1.9 22.3c0 38.2 16.8 72.5 43.3 96c-.2 0-.4 0-.7 0L21.3 320C9.6 320 0 310.4 0 298.7zM405.3 320c-.2 0-.4 0-.7 0c26.6-23.5 43.3-57.8 43.3-96c0-7.6-.7-15-1.9-22.3c13.6-6.3 28.7-9.7 44.6-9.7l42.7 0C592.2 192 640 239.8 640 298.7c0 11.8-9.6 21.3-21.3 21.3l-213.3 0zM224 224a96 96 0 1 1 192 0 96 96 0 1 1 -192 0zM128 485.3C128 411.7 187.7 352 261.3 352l117.3 0C452.3 352 512 411.7 512 485.3c0 14.7-11.9 26.7-26.7 26.7l-330.7 0c-14.7 0-26.7-11.9-26.7-26.7z"/></svg>Social sign-in</button>
        <button class="settings-tab" type="button" id="tab-credits" role="tab" aria-selected="false" aria-controls="panel-credits" data-tab="credits" tabindex="-1"><svg class="fa-icon" aria-hidden="true" viewBox="0 0 512 512"><path d="M512 80c0 18-14.3 34.6-38.4 48c-29.1 16.1-72.5 27.5-122.3 30.9c-3.7-1.8-7.4-3.5-11.3-5C300.6 137.4 248.2 128 192 128c-8.3 0-16.4 .2-24.5 .6l-1.1-.6C142.3 114.6 128 98 128 80c0-44.2 86-80 192-80S512 35.8 512 80zM160.7 161.1c10.2-.7 20.7-1.1 31.3-1.1c62.2 0 117.4 12.3 152.5 31.4C369.3 204.9 384 221.7 384 240c0 4-.7 7.9-2.1 11.7c-4.6 13.2-17 25.3-35 35.5c-35 19.4-90.8 32-153.6 32c-59.6 0-112.9-11.3-148.2-29.1C14.3 274.6 0 258 0 240c0-34.8 53.4-64.5 128-75.4c10.5-1.5 21.4-2.7 32.7-3.5zM416 240c0-21.9-10.6-39.9-24.1-53.4c28.3-4.4 54.2-11.4 76.2-20.5c16.3-6.8 31.5-15.2 43.9-25.5l0 35.4c0 19.3-16.5 37.1-43.8 50.9c-14.6 7.4-32.4 13.7-52.4 18.5c.1-1.8 .2-3.5 .2-5.3zM384 336c0 18-14.3 34.6-38.4 48c-1.8 1-3.6 1.9-5.5 2.9C304.9 404.7 251.6 416 192 416c-62.8 0-118.6-12.6-153.6-32C14.3 370.6 0 354 0 336l0-35.4c12.5 10.3 27.6 18.7 43.9 25.5C83.4 342.6 135.8 352 192 352s108.6-9.4 148.1-25.9c7.8-3.2 15.3-6.9 22.4-10.9c6.1-3.4 11.8-7.2 17.2-11.2c1.5-1.1 2.9-2.3 4.3-3.4l0 3.4 0 5.7 0 26.3zm32 0l0-32 0-25.9c19-4.2 36.5-9.5 52.1-16c16.3-6.8 31.5-15.2 43.9-25.5l0 35.4c0 10.5-5 21-14.9 30.9c-16.3 16.3-45 29.7-81.3 38.4c.1-1.7 .2-3.5 .2-5.3zM192 448c56.2 0 108.6-9.4 148.1-25.9c16.3-6.8 31.5-15.2 43.9-25.5l0 35.4c0 44.2-86 80-192 80S0 476.2 0 432l0-35.4c12.5 10.3 27.6 18.7 43.9 25.5C83.4 438.6 135.8 448 192 448z"/></svg>Teacher credits</button>
        <button class="settings-tab" type="button" id="tab-brand" role="tab" aria-selected="false" aria-controls="panel-brand" data-tab="brand" tabindex="-1"><svg class="fa-icon" aria-hidden="true" viewBox="0 0 512 512"><path d="M512 256c0 .9 0 1.8 0 2.7c-.4 36.5-33.6 61.3-70.1 61.3L344 320c-26.5 0-48 21.5-48 48c0 3.4 .4 6.7 1 9.9c2.1 10.2 6.5 20 10.8 29.9c6.1 13.8 12.1 27.5 12.1 42c0 31.8-21.6 60.7-53.4 62c-3.5 .1-7 .2-10.6 .2C114.6 512 0 397.4 0 256S114.6 0 256 0S512 114.6 512 256zM128 288a32 32 0 1 0 -64 0 32 32 0 1 0 64 0zm0-96a32 32 0 1 0 0-64 32 32 0 1 0 0 64zM288 96a32 32 0 1 0 -64 0 32 32 0 1 0 64 0zm96 96a32 32 0 1 0 0-64 32 32 0 1 0 0 64z"/></svg>Brand & theme</button>
      </div>
      <section class="settings-panel" id="panel-ai" role="tabpanel" aria-labelledby="tab-ai" data-panel="ai">
        <h2>AI provider</h2>
        <p class="auth-hint">Choose the service that issued your key. <strong>Grok (xAI API)</strong> and <strong>Groq</strong> are separate services; their keys are not interchangeable. Akademi chooses a default model automatically.</p>
        <div class="settings-saved-view" id="ai-settings-view" aria-live="polite"><p>Loading saved AI settings…</p></div>
        <form id="ai-settings-form" data-settings-editor="ai" hidden data-config-url="<?= e(app_url('api/admin/ai')) ?>" data-test-url="<?= e(app_url('api/admin/ai/test')) ?>" data-credits-url="<?= e(app_url('api/admin/credits')) ?>" data-mail-url="<?= e(app_url('api/admin/mail')) ?>" data-mail-test-url="<?= e(app_url('api/admin/mail/test')) ?>" data-brand-url="<?= e(app_url('api/brand')) ?>" data-brand-save-url="<?= e(app_url('api/admin/brand')) ?>">
          <label class="auth-field"><span>Provider</span><select name="provider" required><option value="xai">Grok (xAI API)</option><option value="openai">OpenAI</option><option value="openrouter">OpenRouter</option><option value="groq">Groq (separate service · free tier)</option></select></label>
          <p id="ai-cost-status" class="auth-hint" role="status" aria-live="polite">Checking provider pricing…</p>
          <label class="auth-field"><span>API key <small id="key-status">Not configured</small></span><input name="api_key" type="password" autocomplete="new-password" maxlength="512" placeholder="Paste key from the selected provider"></label>
          <p id="ai-provider-help" class="auth-hint">Create and manage the API key in the selected provider’s console. Never put an API key in source code or browser storage.</p>
          <button class="auth-submit" type="submit">Save provider settings</button>
          <button class="auth-secondary" id="test-ai" type="button">Test provider connection</button>
        </form>
      </section>
      <section class="settings-panel" id="panel-email" role="tabpanel" aria-labelledby="tab-email" data-panel="email" hidden>
        <h2>Email delivery</h2>
        <p class="auth-hint">Configure SMTP for sign-in codes. The password is encrypted on the server and never returned to this page. Leave it blank to keep the stored password.</p>
        <div class="settings-saved-view" id="mail-settings-view" aria-live="polite"><p>Loading saved email settings…</p></div>
        <form id="mail-settings-form" data-settings-editor="mail" hidden>
          <label class="auth-field"><span>SMTP host</span><input name="host" maxlength="255" placeholder="mail.example.com" autocomplete="url" required></label>
          <div class="form-grid">
            <label class="auth-field"><span>SMTP port</span><input name="port" type="number" min="1" max="65535" step="1" required></label>
            <label class="auth-field"><span>Connection security</span><select name="encryption" required><option value="tls">STARTTLS</option><option value="ssl">SSL/TLS</option><option value="none">None</option></select></label>
          </div>
          <label class="auth-field"><span>SMTP username</span><input name="username" maxlength="255" autocomplete="username"></label>
          <label class="auth-field"><span>SMTP password <small id="mail-password-status">Not configured</small></span><input name="password" type="password" maxlength="512" autocomplete="new-password" placeholder="Blank keeps the current password if it is readable"></label>
          <label class="auth-field"><span>Sender email address</span><input name="from_address" type="email" maxlength="254" autocomplete="email" required></label>
          <label class="auth-field"><span>Sender name</span><input name="from_name" maxlength="120" required></label>
          <button class="auth-submit" type="submit">Save email settings</button>
          <label class="auth-field"><span>Test recipient <small>use the exact address not receiving a code</small></span><input name="test_recipient" type="email" maxlength="254" autocomplete="email" placeholder="Address to test"></label>
          <p class="auth-hint">Signup codes and this test use the same saved SMTP server and sender. SMTP acceptance confirms the server queued a message, not that the recipient inbox delivered it. If this test arrives but codes do not, check spam/quarantine and ask the mail host to trace the recipient and authenticate the sender domain with SPF, DKIM and DMARC.</p>
          <button class="auth-secondary" id="test-mail" type="button">Send test email</button>
        </form>
      </section>
      <section class="settings-panel" id="panel-signin" role="tabpanel" aria-labelledby="tab-signin" data-panel="signin" hidden>
        <h2>Social sign-in</h2>
        <p class="auth-hint">Enable Google and Apple sign-in. Register the exact callback URL with each provider. Apple requires HTTPS and a signed client-secret JWT; never paste its private signing key here.</p>
        <div class="settings-saved-view" id="signin-settings-view" aria-live="polite"><p>Loading saved sign-in settings…</p></div>
        <div id="signin-settings-editors" hidden>
        <form id="oauth-google-form" data-settings-editor="oauth-google" data-provider="google" data-config-url="<?= e(app_url('api/admin/oauth-providers')) ?>">
          <h3>Google</h3>
          <label class="auth-field"><span>Google client ID</span><input name="client_id" maxlength="255" placeholder="Google OAuth client ID"></label>
          <label class="auth-field"><span>Google client secret</span><input name="client_secret" type="password" maxlength="3000" placeholder="Client secret (blank keeps existing)"></label>
          <label class="auth-field"><span>Google callback URL</span><input name="redirect_uri" maxlength="512" placeholder="https://your-domain.example/auth/oauth/google/callback" required></label>
          <label class="auth-field"><span>Enabled</span><select name="enabled"><option value="0">Disabled</option><option value="1">Enabled</option></select></label>
          <button class="auth-submit" type="submit">Save Google settings</button>
        </form>
        <form id="oauth-apple-form" data-settings-editor="oauth-apple" data-provider="apple" data-config-url="<?= e(app_url('api/admin/oauth-providers')) ?>" hidden>
          <h3>Apple</h3>
          <label class="auth-field"><span>Apple client ID (Services ID)</span><input name="client_id" maxlength="255" placeholder="Apple Services ID"></label>
          <label class="auth-field"><span>Apple client-secret JWT</span><input name="client_secret" type="password" maxlength="3000" placeholder="Signed JWT; blank keeps existing"></label>
          <label class="auth-field"><span>Apple callback URL</span><input name="redirect_uri" maxlength="512" placeholder="https://your-domain.example/auth/oauth/apple/callback" required></label>
          <label class="auth-field"><span>Enabled</span><select name="enabled"><option value="0">Disabled</option><option value="1">Enabled</option></select></label>
          <button class="auth-submit" type="submit">Save Apple settings</button>
        </form>
        </div>
      </section>
      <section class="settings-panel" id="panel-credits" role="tabpanel" aria-labelledby="tab-credits" data-panel="credits" hidden>
        <h2>Teacher AI credits</h2>
        <p class="auth-hint">Monthly request credits for each teacher account. Failed provider requests are refunded. Super Admin requests are tracked without reducing the teacher allowance. Changes apply immediately.</p>
        <div id="credit-usage" class="auth-hint" role="status">Loading this month’s usage…</div>
        <div class="settings-saved-view" id="credits-settings-view" aria-live="polite"><p>Loading saved credit settings…</p></div>
        <form id="credit-settings-form" data-settings-editor="credits" hidden>
          <label class="auth-field"><span>Monthly credits per teacher</span><input name="monthly_allowance" type="number" min="0" max="100000" step="1" value="100" required></label>
          <small class="auth-hint">Lesson: 1 credit · Assessment: 2 · Scheme: 2 · Slides: 1.</small>
          <button class="auth-submit" type="submit">Save monthly allowance</button>
        </form>
      </section>
      <section class="settings-panel" id="panel-brand" role="tabpanel" aria-labelledby="tab-brand" data-panel="brand" hidden>
        <h2>Brand colors and appearance</h2>
        <p class="auth-hint">Set the shared colors used throughout Akademi. Teachers can choose light or dark mode for their own device; your brand palette stays consistent in both.</p>
        <div class="settings-saved-view" id="brand-settings-view" aria-live="polite"><p>Loading saved brand settings…</p></div>
        <form id="brand-settings-form" data-settings-editor="brand" hidden>
          <div class="brand-color-grid">
            <label class="auth-field"><span>Primary color <small>Buttons, links and brand marks</small></span><input name="primary_color" type="color" value="#143c32" required></label>
            <label class="auth-field"><span>Secondary color <small>Highlights and secondary accents</small></span><input name="secondary_color" type="color" value="#c69b3c" required></label>
          </div>
          <div class="brand-preview" aria-live="polite">
            <strong>Preview</strong>
            <span class="brand-preview-primary">Primary</span>
            <span class="brand-preview-secondary">Secondary</span>
            <span class="brand-preview-link">Brand link</span>
          </div>
          <button class="auth-submit" type="submit">Save brand colors</button>
        </form>
      </section>
    </section>
      </div>
    </main>
  </div>
  <script src="<?= e(app_url('assets/theme.js?v=2')) ?>" defer></script>
  <script src="<?= e(app_url('assets/notifications.js?v=20')) ?>" defer></script>
  <script src="<?= e(app_url('assets/progress.js?v=6')) ?>" defer></script>
  <script src="<?= e(app_url('assets/auth.js?v=22')) ?>" defer></script>
  <script src="<?= e(app_url('assets/admin-shell.js?v=1')) ?>" defer></script>
  <script src="<?= e(app_url('assets/admin-ai.js?v=26')) ?>" defer></script>
  <script src="<?= e(app_url('assets/ai-assistant.js?v=2')) ?>" defer></script>
</body>
</html>
