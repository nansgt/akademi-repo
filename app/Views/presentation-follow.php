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
  <link rel="stylesheet" href="<?= e(app_url('assets/fontawesome/css/fontawesome.min.css')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/fontawesome/css/solid.min.css')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/styles.css?v=138')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/presentation-follow.css?v=20')) ?>">
  <script src="<?= e(app_url('assets/presentation-follow.js?v=21')) ?>" defer></script>
</head>
<body class="presentation-follow-page">
  <main class="presentation-follow-shell">
    <header class="presentation-follow-header">
      <a class="presentation-follow-brand" href="<?= e(app_url('')) ?>" aria-label="Akademi home">AKADEMI</a>
      <p data-follow-status role="status" aria-live="polite">Connecting to your teacher…</p>
    </header>
    <div class="presentation-follow-progress" aria-label="Presentation progress"><span data-follow-progress></span></div>
    <section class="presentation-follow-main" aria-live="polite">
      <section class="presentation-follow-join" data-follow-join aria-labelledby="follow-join-title">
        <div class="presentation-follow-join-card">
          <span class="presentation-follow-join-icon" aria-hidden="true">👋</span>
          <h1 id="follow-join-title">Welcome to class</h1>
          <p>Enter your name so your teacher can recognize your poll answers and questions.</p>
          <form data-follow-join-form>
            <label for="follow-student-name">Your name</label>
            <input id="follow-student-name" name="name" maxlength="80" autocomplete="name" required placeholder="e.g. Ama">
            <button type="submit"><i class="fa-solid fa-arrow-right-to-bracket" aria-hidden="true"></i> Join presentation</button>
          </form>
        </div>
      </section>
      <div class="presentation-follow-experience" data-follow-experience hidden>
        <div class="presentation-follow-stage" data-follow-stage>
          <div class="presentation-follow-placeholder">Waiting for the teacher to start the presentation…</div>
        </div>
        <section class="presentation-follow-poll" data-follow-poll hidden aria-live="polite"></section>
        <nav class="presentation-follow-reactions" id="follow-reactions" data-follow-reactions aria-label="Classroom pace responses" hidden></nav>
        <details class="presentation-follow-questions" data-follow-question-panel>
          <summary><i class="fa-solid fa-circle-question" aria-hidden="true"></i> Ask your teacher <span class="presentation-follow-counter" data-follow-question-count hidden></span></summary>
          <div data-follow-questions></div>
          <form data-follow-question-form>
            <label for="follow-student-question">Your question</label>
            <textarea id="follow-student-question" name="question" maxlength="1000" required rows="2" placeholder="Ask a question about the lesson…"></textarea>
            <button type="submit"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Send question <span class="presentation-follow-counter" hidden></span></button>
          </form>
        </details>
        <footer class="presentation-follow-footer">
          <span data-follow-title>Live classroom presentation</span>
          <div><strong data-follow-timer aria-live="off"></strong><strong data-follow-count aria-live="polite"></strong><button type="button" class="presentation-follow-pace-toggle" data-follow-pace-toggle aria-expanded="false" aria-controls="follow-reactions" hidden><i class="fa-solid fa-gauge-high" aria-hidden="true"></i><span>Show pace</span><span class="presentation-follow-counter" data-follow-pace-count hidden></span></button><button type="button" class="presentation-follow-fullscreen" data-follow-fullscreen aria-label="Enter full screen" aria-pressed="false"><i class="fa-solid fa-expand" aria-hidden="true"></i><span>Full screen</span></button></div>
        </footer>
      </div>
    </section>
  </main>
</body>
</html>
