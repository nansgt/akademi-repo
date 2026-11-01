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
  <meta name="robots" content="noindex,nofollow">
  <link rel="icon" href="<?= e(app_url('assets/icon.svg')) ?>" type="image/svg+xml">
  <link rel="stylesheet" href="<?= e(app_url('assets/fontawesome/css/fontawesome.min.css')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/fontawesome/css/solid.min.css')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/action-icons.css')) ?>">
  <script src="<?= e(app_url('assets/action-icons.js?v=1')) ?>" defer></script>
  <link rel="stylesheet" href="<?= e(app_url('assets/styles.css?v=150')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/auth.css?v=23')) ?>">
  <link rel="stylesheet" href="<?= e(app_url('assets/assessment-take.css?v=11')) ?>">
  <title>Online assessment · Akademi</title>
</head>
<body class="assessment-taking-page">
  <main class="assessment-take-shell">
    <section class="assessment-take-card" id="assessment-entry">
      <span class="auth-kicker">AKADEMI · GHANA SHS</span>
      <h1>Online assessment</h1>
      <p class="assessment-take-intro" id="assessment-entry-intro">Read the assessment instructions before proceeding. Your timer will not start until your identity is verified and you begin.</p>
      <div id="assessment-link-details" class="assessment-honor-notice assessment-link-summary" hidden>
        <strong id="assessment-link-title" class="assessment-link-title">Loading assessment…</strong>
        <p id="assessment-link-meta" class="assessment-link-meta"></p>
        <p id="assessment-link-availability" class="assessment-link-expiry" aria-live="polite"></p>
        <p class="assessment-link-timer-note">Your exam timer starts only after you verify your identity and begin.</p>
        <p id="assessment-link-instructions" class="assessment-link-instructions"></p>
        <p id="assessment-link-security" class="assessment-link-security"></p>
      </div>
      <div class="assessment-honor-notice">
        <strong>Before you begin</strong>
        <ul>
          <li>Use a quiet place and keep this assessment in one browser tab.</li>
          <li>Review the teacher’s security level and instructions before the timer starts. Advanced mode requires fullscreen where your browser supports it.</li>
          <li>Do not copy, photograph, share or look up assessment questions. Written answers may be reviewed by your teacher.</li>
          <li>Browser controls can deter copying and record some shortcut attempts, but they cannot block screenshots from every operating system, app, device or camera.</li>
          <li>Your timer begins only after you review the instructions and start the assessment. Submit before time expires.</li>
        </ul>
      </div>
      <div id="assessment-entry-preview" class="assessment-honor-notice" hidden><strong id="assessment-preview-heading"></strong><p id="assessment-preview-security"></p><p id="assessment-preview-time"></p></div>
      <button class="auth-submit assessment-proceed-button" type="button" id="assessment-proceed" disabled>Proceed to identify yourself</button>
      <button class="small-button assessment-student-results-link" type="button" id="assessment-view-results" hidden>View my assessment results</button>
      <section id="assessment-student-results" class="assessment-student-results" hidden aria-labelledby="assessment-student-results-title">
        <div class="assessment-student-results-heading"><div><span class="auth-kicker">MY LEARNING</span><h2 id="assessment-student-results-title">Assessment results</h2></div><button class="small-button" type="button" id="assessment-close-results">Back to assessment</button></div>
        <p id="assessment-student-results-status" role="status" aria-live="polite"></p>
        <div id="assessment-student-results-list" class="assessment-student-results-list"></div>
      </section>
      <form id="assessment-identity-form" class="assessment-identity-form" hidden>
        <label class="auth-field"><span>Class</span><select name="classId" required><option value="">Choose your class</option></select></label>
        <label class="auth-field"><span>Your name</span><input name="learnerName" required autocomplete="off" maxlength="160" aria-autocomplete="list" aria-controls="assessment-roster-suggestions" placeholder="Start typing your name"><div id="assessment-roster-suggestions" class="assessment-roster-suggestions" role="listbox" hidden></div></label>
        <p id="assessment-identity-help" class="assessment-identity-help" hidden>Select your name from the class list to continue.</p>
        <div id="assessment-credentials" class="assessment-credentials" hidden>
          <label class="auth-field" id="assessment-student-code-field"><span id="assessment-student-code-label">Assessment code</span><input name="accessCode" autocomplete="one-time-code" inputmode="text" maxlength="32" placeholder="Enter the code from your teacher"></label>
          <small id="assessment-student-code-help" class="assessment-identity-help"></small>
          <button class="auth-submit" type="submit" id="assessment-identity-submit">Start assessment</button>
        </div>
      </form>
      <details class="assessment-legacy-entry" id="assessment-legacy-entry" hidden><summary>Already have an individual code? Use code entry</summary><form id="assessment-code-form" class="assessment-code-form"><label class="auth-field"><span>Individual access code</span><input name="code" autocomplete="one-time-code" inputmode="text" maxlength="32" required placeholder="Enter your access code"></label><button class="auth-submit" type="submit" id="assessment-code-submit">Review instructions</button></form></details>
      <p id="assessment-entry-status" role="status" aria-live="polite"></p>
    </section>
    <section class="assessment-take-card active-assessment" id="active-assessment" hidden>
      <div class="assessment-take-header">
        <div><span class="auth-kicker">ONLINE ASSESSMENT</span><h1 id="assessment-title"></h1><p id="assessment-learner"></p></div>
        <div class="assessment-clock" aria-live="polite"><small>Question time remaining</small><strong id="assessment-clock">--:--</strong><small id="assessment-overall-clock"></small><button type="button" id="assessment-fullscreen" class="assessment-fullscreen-button">Enter fullscreen</button></div>
      </div>
      <div class="assessment-honor-notice compact">
        <strong id="assessment-security-heading">Assessment security instructions</strong>
        <p id="assessment-security-instructions"></p>
      </div>
      <p id="assessment-time-per-question" class="assessment-time-per-question"></p>
      <p id="assessment-instructions" class="assessment-take-intro"></p>
      <section class="assessment-response-progress" aria-label="Response progress">
        <div class="assessment-response-progress-heading"><strong>Responses completed</strong><span id="assessment-response-progress-label">0 of 0 answered</span></div>
        <progress id="assessment-response-progress" max="1" value="0" aria-label="Assessment responses completed"></progress>
      </section>
      <form id="assessment-answer-form">
        <div class="assessment-question-progress"><span id="assessment-question-progress"></span></div>
        <div id="assessment-questions"></div>
        <div class="assessment-question-progress"><button type="button" class="small-button" id="assessment-next-question">Next question</button></div>
        <div class="assessment-submit-row"><button type="submit" class="auth-submit">Submit answers</button></div>
      </form>
      <div id="assessment-submit-progress" class="assessment-submit-progress" role="status" aria-live="polite" hidden>
        <span class="assessment-submit-spinner" aria-hidden="true"></span>
        <div>
          <strong id="assessment-submit-progress-title">Sending your responses securely</strong>
          <p id="assessment-submit-progress-message">Please keep this page open while your submission is confirmed.</p>
          <small id="assessment-submit-elapsed" aria-label="Submission time">0s</small>
        </div>
      </div>
      <p id="assessment-active-status" role="status" aria-live="polite"></p>
    </section>
    <dialog id="assessment-submit-dialog" class="assessment-submit-dialog" aria-labelledby="assessment-submit-dialog-title">
      <div class="assessment-submit-dialog-content">
        <span class="auth-kicker">FINAL CHECK</span>
        <h2 id="assessment-submit-dialog-title">Submit your assessment?</h2>
        <p id="assessment-submit-dialog-summary"></p>
        <p class="assessment-submit-dialog-note">After submission, you cannot change your answers.</p>
        <div class="assessment-submit-dialog-actions">
          <button type="button" class="small-button" data-cancel-assessment-submit>Review answers</button>
          <button type="button" class="auth-submit" id="assessment-confirm-submit">Submit assessment</button>
        </div>
      </div>
    </dialog>
    <section class="assessment-take-card assessment-complete-card" id="assessment-complete" hidden>
      <img class="assessment-complete-logo" src="<?= e(app_url('assets/icon.svg')) ?>" alt="" width="54" height="54">
      <span class="assessment-complete-badge"><span aria-hidden="true">✓</span> Assessment received</span>
      <h1>Submission complete</h1>
      <p id="assessment-complete-message">Your answers have been submitted to your teacher.</p>
      <div id="assessment-complete-score" class="assessment-complete-score"></div>
      <button class="small-button" type="button" id="assessment-complete-view-results">View my assessment results</button>
      <p class="assessment-complete-note">Your response has been recorded securely. You may now close this page.</p>
    </section>
  </main>
  <script src="<?= e(app_url('assets/assessment-rendering.js?v=3')) ?>" defer></script>
  <script src="<?= e(app_url('assets/assessment-take.js?v=18')) ?>" defer></script>
</body>
</html>
