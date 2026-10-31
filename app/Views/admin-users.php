<?php
declare(strict_types=1);

$canManageRoles = in_array('superadmin', $adminUser['roles'], true);
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="app-base-path" content="<?= e(app_base_path()) ?>">
  <meta name="csrf-token" content="<?= e(\Akademi\Security\Csrf::token()) ?>">
  <link rel="icon" href="<?= e(app_url('assets/icon.svg')) ?>" type="image/svg+xml">
  <link rel="stylesheet" href="<?= e(app_url('assets/styles.css?v=54')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/notifications.css?v=20')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/auth.css?v=34')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/appearance.css?v=6')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/admin-settings.css?v=9')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/progress.css?v=5')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/ai-assistant.css?v=3')) ?>">
  <title>User management · Akademi</title>
</head>
<body>
  <div class="app-shell">
    <?php $adminActive = 'users'; require __DIR__ . '/admin-sidebar.php'; ?>
    <main class="main-area admin-settings-main">
      <header class="topbar">
        <button class="mobile-menu" id="mobile-menu" type="button" aria-label="Open navigation" aria-expanded="false"><svg class="icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-bars"></use></svg></button>
        <div class="breadcrumb"><span>Platform admin</span><span class="crumb-slash">/</span><strong>User management</strong></div>
        <div class="topbar-actions"><span class="local-badge"><span class="status-dot"></span><?= $canManageRoles ? 'Super Admin' : 'Administrator' ?></span><button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch to dark mode" title="Switch to dark mode"></button></div>
      </header>
      <div class="page-container admin-settings-container">
        <section class="auth-card settings-card users-management" id="users-management"
                 data-api-url="<?= e(app_url('api/admin/users')) ?>"
                 data-can-manage-roles="<?= $canManageRoles ? '1' : '0' ?>">
          <span class="auth-kicker">PLATFORM ADMINISTRATION</span>
          <h1>User management</h1>
          <p class="auth-lead">Find accounts, review verification and manage access. Suspended users are signed out immediately.</p>
          <div id="users-alert" class="auth-alert hidden" role="status"></div>
          <form id="users-filter-form" class="users-filters">
            <label class="auth-field"><span>Search users</span><input name="q" type="search" maxlength="120" placeholder="Name or email address"></label>
            <label class="auth-field"><span>Account status</span><select name="status"><option value="">All current accounts</option><option value="pending">Pending verification</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="deleted">Deleted</option></select></label>
            <button class="auth-submit compact-button" type="submit">Search</button>
          </form>
          <p class="users-permissions-note">
            <?= $canManageRoles
              ? 'Super Admins can grant or remove Administrator access. Super Admin accounts are protected.'
              : 'Administrators can suspend or reactivate teacher accounts. Role changes and administrator accounts are restricted to a Super Admin.' ?>
          </p>
          <div class="users-table-wrap">
            <table class="users-table">
              <thead><tr><th scope="col">User</th><th scope="col">School / region</th><th scope="col">Status</th><th scope="col">Roles</th><th scope="col">Joined / verified</th><th scope="col">Actions</th></tr></thead>
              <tbody id="users-table-body"><tr><td colspan="6">Loading user accounts…</td></tr></tbody>
            </table>
          </div>
          <div class="users-pagination" id="users-pagination" aria-live="polite"></div>
        </section>
      </div>
    </main>
  </div>
  <script src="<?= e(app_url('assets/theme.js?v=2')) ?>" defer></script>
  <script src="<?= e(app_url('assets/notifications.js?v=20')) ?>" defer></script>
  <script src="<?= e(app_url('assets/progress.js?v=5')) ?>" defer></script>
  <script src="<?= e(app_url('assets/auth.js?v=22')) ?>" defer></script>
  <script src="<?= e(app_url('assets/admin-shell.js?v=1')) ?>" defer></script>
  <script src="<?= e(app_url('assets/admin-users.js?v=3')) ?>" defer></script>
  <script src="<?= e(app_url('assets/ai-assistant.js?v=2')) ?>" defer></script>
</body>
</html>
