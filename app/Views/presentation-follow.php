<?php
declare(strict_types=1);

header('Referrer-Policy: no-referrer');
header('X-Robots-Tag: noindex, nofollow');
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="app-base-path" content="<?= e(app_base_path()) ?>">
  <meta name="theme-color" content="#143c32">
  <title>Follow presentation · Akademi</title>
  <link rel="icon" href="<?= e(app_url('assets/icon.svg')) ?>" type="image/svg+xml">
  <link rel="stylesheet" href="<?= e(app_url('assets/styles.css?v=113')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/presentation-follow.css?v=3')) ?>">
  <script src="<?= e(app_url('assets/theme.js?v=2')) ?>" defer></script>
  <script src="<?= e(app_url('assets/presentation-follow.js?v=4')) ?>" defer></script>
</head>
<body class="presentation-follow-page">
  <main class="presentation-follow-shell">
    <header class="presentation-follow-header">
      <a class="presentation-follow-brand" href="<?= e(app_url('')) ?>" aria-label="Akademi home">AKADEMI</a>
      <p data-follow-status role="status" aria-live="polite">Connecting to your teacher…</p>
    </header>
    <div class="presentation-follow-progress" aria-label="Presentation progress"><span data-follow-progress></span></div>
    <section class="presentation-follow-main" aria-live="polite">
      <div class="presentation-follow-stage" data-follow-stage>
        <div class="presentation-follow-placeholder">Waiting for the teacher to start the presentation…</div>
      </div>
      <section class="presentation-follow-poll" data-follow-poll hidden aria-live="polite"></section>
      <nav class="presentation-follow-reactions" data-follow-reactions aria-label="Classroom reactions" hidden></nav>
      <footer class="presentation-follow-footer">
        <span data-follow-title>Live classroom presentation</span>
        <div><strong data-follow-timer aria-live="off"></strong><strong data-follow-count aria-live="polite"></strong><button type="button" class="presentation-follow-fullscreen" data-follow-fullscreen>Full screen</button></div>
      </footer>
    </section>
  </main>
</body>
</html>
