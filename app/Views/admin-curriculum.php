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
  <link rel="stylesheet" href="<?= e(app_url('assets/styles.css?v=40')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/notifications.css?v=20')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/auth.css?v=49')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/appearance.css?v=6')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/admin-settings.css?v=7')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/ai-assistant.css?v=2')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/progress.css?v=5')) ?>">
  <title>Resource library · Akademi</title>
</head>
<body>
  <?php $canManageCurriculum = in_array('superadmin', $adminUser['roles'], true); ?>
  <div class="app-shell">
    <?php $adminActive = 'curriculum'; require __DIR__ . '/admin-sidebar.php'; ?>
    <main class="main-area admin-settings-main" id="curriculum-review"
          data-list-url="<?= e(app_url('api/admin/curriculum')) ?>"
          data-review-base="<?= e(app_url('api/admin/curriculum')) ?>"
          data-can-manage="<?= $canManageCurriculum ? 'true' : 'false' ?>">
      <header class="topbar">
        <button class="mobile-menu" id="mobile-menu" type="button" aria-label="Open navigation" aria-expanded="false"><svg class="icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-bars"></use></svg></button>
        <div class="breadcrumb"><span>Platform admin</span><span class="crumb-slash">/</span><strong>Resource library</strong></div>
        <div class="topbar-actions"><span class="local-badge"><span class="status-dot"></span><?= $canManageCurriculum ? 'Super Admin' : 'Admin' ?></span><button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch to dark mode" title="Switch to dark mode"></button></div>
      </header>
      <div class="page-container admin-settings-container curriculum-admin-container">
      <section class="auth-card settings-card curriculum-content">
      <span class="auth-kicker">TEACHING RESOURCE LIBRARY</span>
      <h1>Resource library</h1>
      <p class="auth-lead"><?= $canManageCurriculum ? 'Manage learning materials, teacher manuals and reusable planning templates. Uploaded text is scanned for week-by-week topics and focal areas; review all suggestions against the source before verifying.' : 'Review uploaded teaching resources and permanently remove resources that should no longer be available.' ?></p>
      <?php if ($canManageCurriculum): ?><div class="auth-alert success">New text-extracted uploads are scanned for explicit week-by-week topics, focal areas and assessment schedules. These remain unverified until you review them against the original source. Reusable format templates must also be verified before AI planning requests can use them.</div><?php endif; ?>
      <div id="curriculum-alert" class="auth-alert hidden" role="status"></div>
      <?php if ($canManageCurriculum): ?><button id="curriculum-upload-open" class="auth-submit upload-submit" type="button"><svg class="icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-upload"></use></svg> Upload learning &amp; teaching resources</button><?php endif; ?>
      <dialog id="curriculum-upload-dialog" class="resource-preview-dialog upload-resource-dialog" aria-labelledby="curriculum-upload-title">
      <div class="resource-preview-dialog-header">
        <div><span class="auth-kicker">PRIVATE RESOURCE UPLOAD</span><h2 id="curriculum-upload-title">Upload learning &amp; teaching resources</h2></div>
        <button class="resource-preview-close" type="button" data-close-upload aria-label="Close upload form">&times;</button>
      </div>
      <form id="curriculum-upload-form" class="curriculum-upload-form">
      <div class="upload-heading"><div><h2>Upload learning &amp; teaching resources</h2><p>Files are kept private until reviewed. To save a planning template, upload its DOCX, PDF, TXT or MD file, choose the matching lesson-plan or scheme-of-work template type, and verify it for AI format guidance.</p></div><svg class="icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-upload"></use></svg></div>
      <label class="auth-field"><span>Files (PDF, DOCX, TXT, MD or CSV; up to 10 files and 80 MB total)</span><input id="curriculum-upload-files" type="file" name="files[]" accept=".pdf,.docx,.txt,.md,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv" multiple required></label>
      <div id="upload-file-preview" class="upload-file-preview"></div>
      <div class="curriculum-upload-progress" id="curriculum-upload-progress" role="status" aria-live="polite" hidden><span id="curriculum-upload-progress-label">Preparing upload…</span><progress id="curriculum-upload-progress-bar" max="100" value="0"></progress></div>
      <div class="upload-metadata">
        <fieldset class="upload-year-field">
          <legend>SHS years covered</legend>
          <div class="upload-year-badges">
            <label class="upload-year-badge"><input type="checkbox" name="year_groups[]" value="SHS1"><span>SHS 1</span></label>
            <label class="upload-year-badge"><input type="checkbox" name="year_groups[]" value="SHS2"><span>SHS 2</span></label>
            <label class="upload-year-badge"><input type="checkbox" name="year_groups[]" value="SHS3"><span>SHS 3</span></label>
          </div>
          <small>Choose every year this resource covers. Leave unselected to infer from the filename.</small>
        </fieldset>
        <label class="auth-field"><span>Subject (optional)</span><input name="subject_name" maxlength="190" placeholder="e.g. Integrated Science"></label>
        <label class="auth-field"><span>Resource type</span><select name="resource_role"><option value="auto">Infer from filename</option><option value="teacher_manual">Teacher manual</option><option value="learner_material">Learning material</option><option value="lesson_template">Lesson plan template</option><option value="scheme_template">Scheme of work template</option><option value="curriculum">Curriculum</option><option value="other">Other resource</option></select></label>
        <div class="upload-resource-type-detail" data-upload-other-type hidden><label class="auth-field"><span>Specify the resource type</span><input name="resource_type_label" maxlength="100" placeholder="e.g. assessment guide"></label></div>
      </div>
      <button class="auth-submit upload-submit" id="curriculum-upload-submit" type="submit"><svg class="icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-upload"></use></svg> Upload resources</button>
      <p class="upload-result" id="curriculum-upload-result" role="status" aria-live="polite"></p>
      <section class="upload-weekly-results" id="curriculum-upload-weekly-results" aria-live="polite" hidden></section>
      </form>
      </dialog>
      <div class="curriculum-toolbar"><div><strong id="curriculum-count">Loading curriculum resources…</strong><small>10 resources per page · PDF cover previews load as you scroll</small></div><button id="refresh-curriculum" class="auth-secondary compact-button" type="button">Refresh</button></div>
      <form id="curriculum-filters" class="curriculum-filters" role="search">
        <label class="auth-field"><span>Search indexed resources</span><input name="q" type="search" maxlength="190" placeholder="Title, subject or source"></label>
        <fieldset class="curriculum-badge-filter"><legend>SHS year</legend><div class="curriculum-filter-badges" data-filter-badges="year_groups">
          <button class="curriculum-filter-badge" type="button" data-filter-value="" aria-pressed="true">All years</button>
          <button class="curriculum-filter-badge" type="button" data-filter-value="SHS1" aria-pressed="false">SHS 1</button>
          <button class="curriculum-filter-badge" type="button" data-filter-value="SHS2" aria-pressed="false">SHS 2</button>
          <button class="curriculum-filter-badge" type="button" data-filter-value="SHS3" aria-pressed="false">SHS 3</button>
        </div></fieldset>
        <fieldset class="curriculum-badge-filter"><legend>Resource type</legend><div class="curriculum-filter-badges" data-filter-badges="resource_roles">
          <button class="curriculum-filter-badge" type="button" data-filter-value="" aria-pressed="true">All types</button>
          <button class="curriculum-filter-badge" type="button" data-filter-value="teacher_manual" aria-pressed="false">Teacher manual</button>
          <button class="curriculum-filter-badge" type="button" data-filter-value="learner_material" aria-pressed="false">Learning material</button>
          <button class="curriculum-filter-badge" type="button" data-filter-value="lesson_template" aria-pressed="false">Lesson template</button>
          <button class="curriculum-filter-badge" type="button" data-filter-value="scheme_template" aria-pressed="false">Scheme template</button>
          <button class="curriculum-filter-badge" type="button" data-filter-value="curriculum" aria-pressed="false">Curriculum</button>
          <button class="curriculum-filter-badge" type="button" data-filter-value="other" aria-pressed="false">Other resource</button>
        </div></fieldset>
        <button class="auth-secondary" type="button" data-clear-filters>Clear filters</button>
      </form>
      <div class="curriculum-bulk-toolbar" data-bulk-toolbar hidden>
        <div><strong data-bulk-selection-count>0 resources selected</strong><small>Only text-extracted, not-yet-verified resources can be selected.</small></div>
        <div class="curriculum-bulk-actions"><button class="auth-secondary compact-button" type="button" data-select-visible>Select eligible on this page</button><button class="auth-secondary compact-button" type="button" data-clear-selection>Clear selection</button><button class="auth-submit compact-button" type="button" data-bulk-verify disabled>Verify selected</button></div>
      </div>
      <div id="curriculum-list" class="curriculum-list" aria-live="polite"></div>
      <div id="curriculum-pagination" class="curriculum-pagination"></div>
      </section>
      </div>
    </main>
  </div>
  <dialog id="resource-preview-dialog" class="resource-preview-dialog" aria-labelledby="resource-preview-title">
    <div class="resource-preview-dialog-header">
      <div><span class="auth-kicker">LEARNING &amp; TEACHING RESOURCE</span><h2 id="resource-preview-title">Resource preview</h2></div>
      <button class="resource-preview-close" type="button" data-close-preview aria-label="Close resource preview">&times;</button>
    </div>
    <div id="resource-preview-content" class="resource-preview-content" aria-live="polite"></div>
  </dialog>
  <dialog id="curriculum-bulk-verify-dialog" class="resource-preview-dialog curriculum-bulk-verify-dialog" aria-labelledby="curriculum-bulk-verify-title">
    <div class="resource-preview-dialog-header">
      <div><span class="auth-kicker">BULK SOURCE VERIFICATION</span><h2 id="curriculum-bulk-verify-title">Verify selected resources</h2></div>
      <button class="resource-preview-close" type="button" data-close-bulk-verify aria-label="Close verification">&times;</button>
    </div>
    <form data-bulk-verify-form class="curriculum-bulk-verify-form">
      <p data-bulk-verify-summary></p>
      <label class="auth-field"><span>What did you check for each selected source? (required)</span><textarea name="review_notes" rows="4" minlength="10" maxlength="500" required placeholder="Confirm the publisher, document/version, SHS year, subject, and that the extracted text matches the source."></textarea></label>
      <p class="field-help">Each resource keeps its existing source reference, or uses its document title if none is recorded. This review note is saved separately on every selected resource. Only text-extracted resources can be verified.</p>
      <div class="curriculum-bulk-verify-actions"><button class="auth-secondary" type="button" data-cancel-bulk-verify>Cancel</button><button class="auth-submit" type="submit" data-submit-bulk-verify>Verify resources</button></div>
      <p data-bulk-verify-status role="status" aria-live="polite"></p>
    </form>
  </dialog>
  <script src="<?= e(app_url('assets/theme.js?v=2')) ?>" defer></script>
  <script src="<?= e(app_url('assets/notifications.js?v=20')) ?>" defer></script>
  <script src="<?= e(app_url('assets/progress.js?v=5')) ?>" defer></script>
  <script src="<?= e(app_url('assets/auth.js?v=22')) ?>" defer></script>
  <script src="<?= e(app_url('assets/admin-shell.js?v=1')) ?>" defer></script>
  <dialog id="curriculum-resource-reader" class="curriculum-reader-dialog" aria-labelledby="curriculum-reader-title">
    <header class="curriculum-reader-header"><div class="curriculum-reader-heading"><div class="curriculum-reader-kicker"><span class="curriculum-reader-filetype">PDF</span><span>CURRICULUM RESOURCE</span></div><h2 id="curriculum-reader-title">Read resource</h2><p data-reader-meta></p></div><button type="button" class="curriculum-reader-close" data-reader-close aria-label="Close resource reader" title="Close reader"><svg class="icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg#fa-xmark')) ?>"></use></svg></button></header>
    <nav class="curriculum-reader-toolbar" data-reader-toolbar aria-label="PDF reader controls" hidden></nav>
    <main class="curriculum-reader-content" data-reader-content aria-live="polite"></main>
    <nav class="curriculum-reader-pagination" data-reader-pagination aria-label="Resource pages"></nav>
  </dialog>
  <script src="<?= e(app_url('assets/curriculum-docx-renderer.js?v=1')) ?>" defer></script>
  <script src="<?= e(app_url('assets/curriculum-resource-reader.js?v=10')) ?>" defer></script>
  <script src="<?= e(app_url('assets/admin-curriculum.js?v=64')) ?>" defer></script>
  <script src="<?= e(app_url('assets/ai-assistant.js?v=2')) ?>" defer></script>
</body>
</html>
