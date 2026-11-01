<?php
declare(strict_types=1);

$errorType = $errorType ?? 'server';
$statusCode = $statusCode ?? 500;
$requestReference = $requestReference ?? '';
$errorContent = [
    'not-found' => [
        'eyebrow' => 'PAGE NOT FOUND',
        'title' => 'This page took a wrong turn.',
        'message' => 'We couldn’t find the page you were looking for. It may have moved, or the address may be incomplete.',
        'action' => 'Go to workspace',
    ],
    'forbidden' => [
        'eyebrow' => 'ACCESS RESTRICTED',
        'title' => 'This space is for another role.',
        'message' => 'Your account doesn’t have permission to open this page. If you think that’s a mistake, ask your school administrator.',
        'action' => 'Return to workspace',
    ],
    'database' => [
        'eyebrow' => 'WORKSPACE CONNECTION',
        'title' => 'We can’t reach the workspace data.',
        'message' => 'The application couldn’t complete a database request. Please try again shortly; if this continues, share the reference code with your administrator.',
        'action' => 'Try again',
    ],
    'unavailable' => [
        'eyebrow' => 'SERVICE TEMPORARILY UNAVAILABLE',
        'title' => 'A service needs a moment.',
        'message' => 'Akademi couldn’t complete this request right now. Please try again shortly. Your administrator can use the reference code to investigate.',
        'action' => 'Try again',
    ],
    'request' => [
        'eyebrow' => 'REQUEST NEEDS ATTENTION',
        'title' => 'Let’s get this back on track.',
        'message' => 'This request couldn’t be completed as sent. Return to the previous page and check the information before trying again.',
        'action' => 'Return to workspace',
    ],
    'server' => [
        'eyebrow' => 'UNEXPECTED INTERRUPTION',
        'title' => 'We hit a little snag.',
        'message' => 'Akademi couldn’t complete this request. Please try again, or share the reference code with your administrator if the problem continues.',
        'action' => 'Try again',
    ],
];
$copy = $errorContent[$errorType] ?? $errorContent['server'];
$homeUrl = app_url('');
$actionUrl = in_array($errorType, ['database', 'unavailable', 'server'], true)
    ? app_url(ltrim((string)($path ?? '/'), '/'))
    : $homeUrl;
$workspacePages = ['dashboard', 'lesson', 'assessment', 'scheme', 'schedule', 'slides', 'documents', 'curriculum', 'profile'];
$requestedPage = (string)($_GET['page'] ?? '');
$workspaceUrl = in_array($requestedPage, $workspacePages, true)
    ? $homeUrl . '?page=' . rawurlencode($requestedPage)
    : $homeUrl;
if (in_array($errorType, ['database', 'unavailable', 'server'], true)
    && ($path ?? '/') === '/'
    && $workspaceUrl !== $homeUrl) {
    $actionUrl = $workspaceUrl;
}
$statusCode = (int)$statusCode;
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#143c32">
  <meta name="app-base-path" content="<?= e(app_base_path()) ?>">
  <link rel="icon" href="<?= e(app_url('assets/icon.svg')) ?>" type="image/svg+xml">
  <link rel="stylesheet" href="<?= e(app_url('assets/error-page.css?v=1')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/fontawesome/css/fontawesome.min.css')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/fontawesome/css/solid.min.css')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/action-icons.css')) ?>">
  <script src="<?= e(app_url('assets/action-icons.js?v=1')) ?>" defer></script>
  <script src="<?= e(app_url('assets/error-page.js?v=1')) ?>" defer></script>
  <title><?= e($copy['eyebrow']) ?> · Akademi</title>
</head>
<body>
  <main class="error-shell" data-error-type="<?= e($errorType) ?>">
    <header class="error-topbar">
      <a class="error-brand" href="<?= e($homeUrl) ?>" aria-label="Akademi home"><span class="error-brand-mark">A</span><span>akademi</span></a>
      <button class="error-theme-toggle" type="button" data-theme-toggle aria-label="Switch to dark mode"><svg aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-moon"></use></svg><span>Switch to dark mode</span></button>
    </header>
    <section class="error-card" aria-labelledby="error-title">
      <div class="error-copy">
        <span class="error-eyebrow"><span class="error-status-dot"></span><?= e($copy['eyebrow']) ?></span>
        <p class="error-code" aria-label="Error code"><?= e((string)$statusCode) ?></p>
        <h1 id="error-title"><?= e($copy['title']) ?></h1>
        <p class="error-message"><?= e($copy['message']) ?></p>
        <?php if ($requestReference !== ''): ?>
          <div class="error-reference"><span>Reference code</span><code id="error-reference-value"><?= e($requestReference) ?></code><button type="button" data-copy-reference aria-label="Copy reference code">Copy</button></div>
        <?php endif; ?>
        <div class="error-actions">
          <a class="error-primary-action" href="<?= e($actionUrl) ?>"><?= e($copy['action']) ?></a>
          <a class="error-secondary-action" href="<?= e($workspaceUrl) ?>">Back to workspace</a>
        </div>
        <p class="error-help">Need a hand? Send the reference code to your administrator.</p>
      </div>
      <div class="error-art" role="img" aria-label="<?= e($copy['eyebrow']) ?> illustration">
        <svg viewBox="0 0 440 360" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <ellipse class="art-shadow" cx="222" cy="316" rx="144" ry="17"/>
          <path class="art-blob" d="M63 183c-4-63 37-110 96-123 53-12 95 14 132 23 49 12 91 37 92 92 1 51-34 83-57 112-28 34-70 41-127 35-71-8-132-29-136-78-2-23 2-40 0-61Z"/>
          <g class="art-spark art-spark-one"><path d="M89 86v20M79 96h20"/></g>
          <g class="art-spark art-spark-two"><path d="M348 129v16M340 137h16"/></g>
          <g class="art-paper">
            <rect x="119" y="68" width="184" height="221" rx="22"/>
            <path class="art-paper-fold" d="M257 68v42h46"/>
            <path class="art-paper-line" d="M151 139h94M151 165h119M151 191h83"/>
            <circle class="art-face" cx="194" cy="237" r="25"/>
            <path class="art-face-line" d="M184 236h.5M203 236h.5M187 247c4 4 10 4 14 0"/>
            <path class="art-arm" d="M120 211 95 229M302 210l26 14"/>
            <path class="art-leg" d="m171 288-7 19M251 288l7 19"/>
          </g>
          <g class="art-lock">
            <rect x="287" y="214" width="66" height="57" rx="15"/>
            <path d="M303 214v-12a17 17 0 0 1 34 0v12"/>
            <circle cx="320" cy="239" r="4"/><path d="M320 243v9"/>
          </g>
          <g class="art-server">
            <rect x="294" y="208" width="71" height="31" rx="9"/>
            <rect x="294" y="247" width="71" height="31" rx="9"/>
            <path d="M307 224h26M307 263h26"/>
            <circle cx="349" cy="224" r="3"/><circle cx="349" cy="263" r="3"/>
          </g>
          <g class="art-question"><circle cx="320" cy="241" r="33"/><path d="M312 232a9 9 0 1 1 15 7c-5 4-7 5-7 11M320 260h.1"/></g>
        </svg>
        <span class="art-caption">Every good lesson has a next step.</span>
      </div>
    </section>
    <footer class="error-footer"><span>Akademi · Ghana teacher workspace</span><span>We’ll help you find your way back.</span></footer>
  </main>
</body>
</html>
