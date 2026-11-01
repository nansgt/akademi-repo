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
  <link rel="stylesheet" href="<?= e(app_url('assets/notifications.css?v=20')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/auth.css?v=23')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/appearance.css?v=5')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/progress.css?v=5')) ?>">
  <title>Account security · Akademi</title>
</head>
<body>
  <main class="auth-shell">
    <section class="auth-card">
      <a class="auth-brand" href="<?= e(app_url('')) ?>"><span class="auth-mark">A</span><span><strong>akademi</strong><small>ACCOUNT SECURITY</small></span></a>
      <span class="auth-kicker">SIGNED IN AS <?= e(strtoupper((string)$user['email'])) ?></span>
      <h1>Set your password</h1>
      <p class="auth-lead">Use at least 12 characters. You can keep signing in with one-time email codes as a fallback.</p>
      <div id="password-alert" class="auth-alert hidden" role="status"></div>
      <form id="account-password-form" data-endpoint="<?= e(app_url('api/account/password')) ?>">
        <label class="auth-field"><span>Current password <small>Required if you already have one, unless you recently signed in with an email code</small></span><input name="current_password" type="password" autocomplete="current-password" maxlength="72"></label>
        <label class="auth-field"><span>New password</span><input name="new_password" type="password" autocomplete="new-password" minlength="12" maxlength="72" required></label>
        <label class="auth-field"><span>Confirm new password</span><input name="confirm_password" type="password" autocomplete="new-password" minlength="12" maxlength="72" required></label>
        <button class="auth-submit" type="submit">Save password</button>
      </form>
      <p class="auth-switch"><a class="auth-link" href="<?= e(app_url('')) ?>"><svg class="icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-chevron-left"></use></svg> Return to your workspace</a></p>
    </section>
  </main>
  <script src="<?= e(app_url('assets/theme.js?v=2')) ?>" defer></script>
  <script src="<?= e(app_url('assets/notifications.js?v=20')) ?>" defer></script>
  <script src="<?= e(app_url('assets/progress.js?v=5')) ?>" defer></script>
  <script src="<?= e(app_url('assets/account-security.js?v=18')) ?>" defer></script>
</body>
</html>
