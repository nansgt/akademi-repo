<?php
declare(strict_types=1);

$mode = $mode ?? 'login';
$pendingEmail = $pendingEmail ?? '';
$errorMessage = $errorMessage ?? '';
$oauthProviders = $oauthProviders ?? [];
$baseUrl = app_base_path();
$headings = [
    'login' => ['Welcome back', 'Sign in with your email and password, or request a one-time email code.'],
    'register' => ['Create your teacher account', 'Start a private planning workspace for your teaching.'],
    'verify' => ['Check your email', 'Enter the six-digit code we sent to continue.'],
];
$heading = $headings[$mode] ?? $headings['login'];
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="app-base-path" content="<?= e(app_base_path()) ?>">
  <meta name="theme-color" content="#143c32">
  <meta name="csrf-token" content="<?= e(\Akademi\Security\Csrf::token()) ?>">
  <meta name="csrf-endpoint" content="<?= e(app_base_path() . '/api/auth/csrf-token') ?>">
  <link rel="icon" href="<?= e(app_url('assets/icon.svg')) ?>" type="image/svg+xml">
  <link rel="stylesheet" href="<?= e(app_url('assets/notifications.css?v=20')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/auth.css?v=23')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/appearance.css?v=5')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/progress.css?v=5')) ?>">
  <title><?= e($heading[0]) ?> · Akademi</title>
</head>
<body>
  <main class="auth-shell">
    <section class="auth-card">
      <a class="auth-brand" href="<?= e(app_url('')) ?>"><span class="auth-mark">A</span><span><strong>akademi</strong><small>GHANA · TEACHER WORKSPACE</small></span></a>
      <span class="auth-kicker">A SECURE TEACHER WORKSPACE</span>
      <h1><?= e($heading[0]) ?></h1>
      <p class="auth-lead"><?= e($heading[1]) ?></p>
      <div id="auth-alert" class="auth-alert<?= $errorMessage === '' ? ' hidden' : '' ?>" role="alert"><?= e($errorMessage) ?></div>

      <?php if ($mode === 'verify'): ?>
        <form id="verify-form" data-endpoint="<?= e(app_base_path() . '/api/auth/verify') ?>">
          <label class="auth-field"><span>Six-digit email code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required autofocus></label>
          <button class="auth-submit" type="submit">Verify and continue</button>
        </form>
        <form id="resend-form" data-endpoint="<?= e(app_base_path() . '/api/auth/resend') ?>">
          <button class="auth-secondary" type="submit">Send another code</button>
        </form>
        <p class="auth-hint">Code sent to <?= e($pendingEmail) ?>. It expires after 10 minutes. Check your spam folder if needed.</p>
        <a class="auth-link" href="<?= e(app_url('login')) ?>">Back to sign in</a>
      <?php elseif ($mode === 'register'): ?>
        <form id="register-form" data-endpoint="<?= e(app_base_path() . '/api/auth/register') ?>">
          <label class="auth-field"><span>Full name</span><input name="name" autocomplete="name" maxlength="120" required></label>
          <label class="auth-field"><span>Email address</span><input name="email" type="email" autocomplete="email" maxlength="254" required></label>
          <button class="auth-submit" type="submit">Create account and send code</button>
        </form>
        <p class="auth-switch">Already registered? <a class="auth-link" href="<?= e(app_url('login')) ?>">Sign in</a></p>
        <?php if ($oauthProviders !== []): ?>
          <div class="auth-oauth">
            <p class="auth-or">or</p>
            <p>
              <?php if (in_array('google', $oauthProviders, true)): ?>
                <a class="auth-oauth-btn auth-oauth-google" href="<?= e(app_url('auth/oauth/google')) ?>">Continue with Google</a>
              <?php endif; ?>
              <?php if (in_array('apple', $oauthProviders, true)): ?>
                <a class="auth-oauth-btn auth-oauth-apple" href="<?= e(app_url('auth/oauth/apple')) ?>">Continue with Apple</a>
              <?php endif; ?>
            </p>
          </div>
        <?php endif; ?>
      <?php else: ?>
        <form id="password-login-form" data-endpoint="<?= e(app_base_path() . '/api/auth/password-login') ?>">
          <label class="auth-field"><span>Email address</span><input name="email" type="email" autocomplete="username" maxlength="254" required autofocus></label>
          <label class="auth-field"><span>Password</span><input name="password" type="password" autocomplete="current-password" maxlength="72" required></label>
          <button class="auth-submit" type="submit">Sign in</button>
        </form>
        <p class="auth-switch"><button class="auth-link auth-link-button" id="show-code-login" type="button">Use a one-time email code instead</button></p>
        <div id="code-login-panel" class="hidden">
        <form id="login-form" data-endpoint="<?= e(app_base_path() . '/api/auth/login') ?>">
          <label class="auth-field"><span>Email address</span><input name="email" type="email" autocomplete="email" maxlength="254" required autofocus></label>
          <button class="auth-submit" type="submit">Email me a sign-in code</button>
        </form>
        <p class="auth-switch"><button class="auth-link auth-link-button" id="show-password-login" type="button">Back to password sign-in</button></p>
        <p class="auth-hint">Forgot your password, or still need to verify a new account? Use an email code with the same address. If the message is delayed, check your spam folder.</p>
        </div>
        <p class="auth-switch">New to Akademi? <a class="auth-link" href="<?= e(app_url('register')) ?>">Create a teacher account</a></p>
        <?php if ($oauthProviders !== []): ?>
          <div class="auth-oauth">
            <p class="auth-or">or</p>
            <p>
              <?php if (in_array('google', $oauthProviders, true)): ?>
                <a class="auth-oauth-btn auth-oauth-google" href="<?= e(app_url('auth/oauth/google')) ?>">Sign in with Google</a>
              <?php endif; ?>
              <?php if (in_array('apple', $oauthProviders, true)): ?>
                <a class="auth-oauth-btn auth-oauth-apple" href="<?= e(app_url('auth/oauth/apple')) ?>">Sign in with Apple</a>
              <?php endif; ?>
            </p>
          </div>
        <?php endif; ?>
      <?php endif; ?>
      <p class="auth-disclaimer">Akademi is independent of Ghana’s Ministry of Education, NaCCA and GES. Curriculum content must be checked against current official sources.</p>
    </section>
  </main>
  <script src="<?= e(app_url('assets/theme.js?v=2')) ?>" defer></script>
  <script src="<?= e(app_url('assets/notifications.js?v=20')) ?>" defer></script>
  <script src="<?= e(app_url('assets/progress.js?v=5')) ?>" defer></script>
  <script src="<?= e(app_url('assets/auth.js?v=18')) ?>" defer></script>
</body>
</html>
