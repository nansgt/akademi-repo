<?php
$adminActive = $adminActive ?? '';
$adminUser = $adminUser ?? [];
$adminLabel = in_array('superadmin', $adminUser['roles'] ?? [], true) ? 'Super Admin' : 'Administrator';
$workspaceLink = static fn(string $page): string => app_url('?page=' . rawurlencode($page));
?>
<aside class="sidebar" id="sidebar" aria-label="Main navigation">
  <div class="sidebar-heading">
    <a class="brand" href="<?= e($workspaceLink('dashboard')) ?>" aria-label="Akademi home">
      <span class="brand-mark" aria-hidden="true">A</span>
      <span class="brand-copy"><strong>akademi</strong><small>GHANA · TEACHER WORKSPACE</small></span>
    </a>
    <button class="sidebar-collapse" id="sidebar-collapse" type="button" aria-label="Collapse sidebar" title="Collapse sidebar"><svg class="icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-angles-left"></use></svg></button>
  </div>
  <div class="nav-label">WORKSPACE</div>
  <nav class="main-nav" aria-label="Workspace tools">
    <a class="nav-item" href="<?= e($workspaceLink('dashboard')) ?>" title="Overview"><svg class="nav-icon icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-house"></use></svg><span class="nav-text">Overview</span></a>
    <a class="nav-item" href="<?= e($workspaceLink('lesson')) ?>" title="Lesson planner"><svg class="nav-icon icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-book-open"></use></svg><span class="nav-text">Lesson planner</span></a>
    <a class="nav-item" href="<?= e($workspaceLink('assessment')) ?>" title="Assessment builder"><svg class="nav-icon icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-clipboard-check"></use></svg><span class="nav-text">Assessment builder</span></a>
    <a class="nav-item" href="<?= e($workspaceLink('scheme')) ?>" title="Scheme of work"><svg class="nav-icon icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-file-lines"></use></svg><span class="nav-text">Scheme of work</span></a>
    <a class="nav-item" href="<?= e($workspaceLink('schedule')) ?>" title="Teaching schedule"><svg class="nav-icon icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-calendar-days"></use></svg><span class="nav-text">Teaching schedule</span></a>
    <a class="nav-item" href="<?= e($workspaceLink('slides')) ?>" title="Presentation outline"><svg class="nav-icon icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-file-lines"></use></svg><span class="nav-text">Presentation outline</span></a>
  </nav>
  <div class="nav-label nav-label-spaced">YOUR SPACE</div>
  <nav class="main-nav" aria-label="Your workspace">
    <a class="nav-item" href="<?= e($workspaceLink('documents')) ?>" title="My documents"><svg class="nav-icon icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-folder-open"></use></svg><span class="nav-text">My documents</span></a>
    <a class="nav-item" href="<?= e($workspaceLink('curriculum')) ?>" title="Curriculum resources"><svg class="nav-icon icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-graduation-cap"></use></svg><span class="nav-text">Curriculum resources</span></a>
  </nav>
  <div class="nav-label nav-label-spaced">PLATFORM ADMIN</div>
  <nav class="main-nav" aria-label="Platform administration">
    <a class="nav-item <?= $adminActive === 'users' ? 'active' : '' ?>" href="<?= e(app_url('admin/users')) ?>" <?= $adminActive === 'users' ? 'aria-current="page"' : '' ?> title="User management"><svg class="nav-icon icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-user"></use></svg><span class="nav-text">User management</span></a>
    <?php if (array_intersect(['admin', 'superadmin'], $adminUser['roles'] ?? []) !== []): ?>
      <a class="nav-item <?= $adminActive === 'curriculum' ? 'active' : '' ?>" href="<?= e(app_url('admin/curriculum')) ?>" <?= $adminActive === 'curriculum' ? 'aria-current="page"' : '' ?> title="Curriculum review"><svg class="nav-icon icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-book-open"></use></svg><span class="nav-text">Curriculum review</span></a>
    <?php endif; ?>
    <?php if (in_array('superadmin', $adminUser['roles'] ?? [], true)): ?>
      <a class="nav-item <?= $adminActive === 'settings' ? 'active' : '' ?>" href="<?= e(app_url('admin/ai')) ?>" <?= $adminActive === 'settings' ? 'aria-current="page"' : '' ?> title="Platform settings"><svg class="nav-icon icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-gear"></use></svg><span class="nav-text">Platform settings</span></a>
    <?php endif; ?>
  </nav>
  <div class="sidebar-bottom">
    <div class="offline-note"><span class="status-dot"></span><span><strong><?= e($adminLabel) ?></strong><small>Platform administration</small></span></div>
    <form id="logout-form" data-endpoint="<?= e(app_url('api/auth/logout')) ?>"><button class="profile-link" type="submit"><span class="avatar" aria-hidden="true">A</span><span class="profile-text"><strong>Sign out</strong><small>End this session</small></span><svg class="profile-more icon" aria-hidden="true"><use href="<?= e(app_url('assets/icons.svg')) ?>#fa-chevron-right"></use></svg></button></form>
  </div>
</aside>
