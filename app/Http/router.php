<?php
declare(strict_types=1);

use Akademi\Database\Connection;
use Akademi\Security\Csrf;
use Akademi\Services\AiProviderService;
use Akademi\Services\AiCreditService;
use Akademi\Services\AuthService;
use Akademi\Services\CurriculumReviewService;
use Akademi\Services\CurriculumIngestionService;
use Akademi\Services\CurriculumSearchService;
use Akademi\Services\CurriculumStructureService;
use Akademi\Services\CurriculumTopicDiscoveryService;
use Akademi\Services\NaccaCurriculumCatalogService;
use Akademi\Services\Mailer;
use Akademi\Services\OnlineAssessmentService;
use Akademi\Services\WorkspaceService;

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
header('Cache-Control: no-store, private');

$requestId = bin2hex(random_bytes(16));
$uriPath = parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$path = is_string($uriPath) ? $uriPath : '/';
$basePath = app_base_path();
if ($basePath !== '' && ($path === $basePath || str_starts_with($path, $basePath . '/'))) {
    $path = substr($path, strlen($basePath));
}
$path = '/' . trim($path, '/');
if ($path === '//') {
    $path = '/';
}
$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$isAdminCurriculumFile = $method === 'GET'
    && preg_match('#^/api/admin/curriculum/[1-9][0-9]*/file$#D', $path) === 1;
$framePolicy = $isAdminCurriculumFile ? "'self'" : "'none'";
header('X-Frame-Options: ' . ($isAdminCurriculumFile ? 'SAMEORIGIN' : 'DENY'));
$stylePolicy = in_array($path, ['/', '/index.html', '/admin/curriculum'], true)
    ? "style-src 'self' 'unsafe-inline'"
    : "style-src 'self'";
header("Content-Security-Policy: default-src 'self'; script-src 'self'; {$stylePolicy}; img-src 'self' data: blob: https:; connect-src 'self' https://commons.wikimedia.org; frame-src 'self' blob:; form-action 'self'; base-uri 'self'; frame-ancestors {$framePolicy}; object-src 'none'");
$auth = new AuthService();

function page_auth(string $mode, string $email = '', string $error = ''): never
{
    $pendingEmail = $email;
    $errorMessage = $error;
    $oauthProviders = (new \Akademi\Services\OAuthProviderService())->enabledProviders();
    require AKADEMI_ROOT . DIRECTORY_SEPARATOR . 'app' . DIRECTORY_SEPARATOR . 'Views' . DIRECTORY_SEPARATOR . 'auth.php';
    exit;
}

function require_user(AuthService $auth): array
{
    $user = $auth->currentUser();
    if (!$user) {
        json_response(['error' => 'Sign in to continue.'], 401);
    }
    return $user;
}

function serve_curriculum_resource(array $file, bool $download = false): never
{
    $mimeType = match ($file['mime_type']) {
        'application/pdf' => 'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' =>
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain' => 'text/plain',
        'text/markdown' => 'text/markdown',
        'text/csv' => 'text/csv',
        default => 'application/octet-stream',
    };
    $disposition = $mimeType === 'application/pdf' && !$download ? 'inline' : 'attachment';
    header('Content-Type: ' . $mimeType);
    header('Content-Disposition: ' . $disposition . '; filename="resource"; filename*=UTF-8\'\'' . rawurlencode($file['filename']));
    header('Content-Length: ' . (string)$file['bytes']);
    header('Cache-Control: private, no-store, max-age=0');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    readfile($file['path']);
    exit;
}

try {
    if ($method === 'GET' && in_array($path, ['/login', '/register', '/verify', '/account/security'], true)) {
        if ($path === '/account/security') {
            $user = $auth->currentUser();
            if (!$user) {
                header('Location: ' . app_url('login'), true, 303);
                exit;
            }
            require AKADEMI_ROOT . DIRECTORY_SEPARATOR . 'app' . DIRECTORY_SEPARATOR . 'Views' . DIRECTORY_SEPARATOR . 'account-security.php';
            exit;
        }
        if ($path === '/verify') {
            $pending = $_SESSION['pending_auth'] ?? null;
            if (!is_array($pending) || !isset($pending['email'])) {
                header('Location: ' . app_url('login'), true, 303);
                exit;
            }
            page_auth('verify', (string)$pending['email']);
        }
        page_auth($path === '/register' ? 'register' : 'login');
    }

    if ($method === 'GET' && $path === '/health') {
        json_response(['status' => 'ok', 'time' => gmdate('c')]);
    }

    if ($method === 'GET' && $path === '/api/brand') {
        json_response((new \Akademi\Services\BrandSettingsService())->get());
    }

    if ($method === 'GET' && $path === '/api/auth/csrf-token') {
        json_response(['csrf_token' => Csrf::token()]);
    }

    if (preg_match('#^/auth/oauth/(google|apple)$#D', $path, $matches) && $method === 'GET') {
        $provider = $matches[1];
        $oauth = new \Akademi\Services\OAuthProviderService();
        $attempt = $oauth->begin($provider);
        $config = $attempt['config'];
        $params = [
            'client_id' => $config['client_id'],
            'response_type' => 'code',
            'redirect_uri' => $config['redirect_uri'],
            'state' => $attempt['state'],
            'nonce' => $attempt['nonce'],
        ];
        if ($provider === 'google') {
            $params['scope'] = 'openid email profile';
            $params['access_type'] = 'online';
            $params['prompt'] = 'select_account';
            $authorizationUrl = 'https://accounts.google.com/o/oauth2/v2/auth?';
        } else {
            $params['response_mode'] = 'form_post';
            $params['scope'] = 'name email';
            $authorizationUrl = 'https://appleid.apple.com/auth/authorize?';
        }
        header('Location: ' . $authorizationUrl . http_build_query($params), true, 302);
        exit;
    }

    if (preg_match('#^/auth/oauth/(google|apple)/callback$#D', $path, $matches) && in_array($method, ['GET', 'POST'], true)) {
        $provider = $matches[1];
        $input = $method === 'POST' ? $_POST : $_GET;
        if (!empty($input['error'])) {
            throw new RuntimeException('Sign-in with the identity provider was cancelled or denied.', 422);
        }
        $oauth = new \Akademi\Services\OAuthProviderService();
        $nonceHash = $oauth->consumeState($provider, (string)($input['state'] ?? ''));
        $oauth->authenticate($provider, (string)($input['code'] ?? ''), $nonceHash);
        header('Location: ' . app_url(''), true, 303);
        exit;
    }

    if ($method === 'POST' && in_array($path, ['/api/auth/register', '/api/auth/login', '/api/auth/password-login', '/api/auth/verify', '/api/auth/resend', '/api/auth/logout'], true)) {
        Csrf::verifyRequest();
        $input = request_json();
        if ($path === '/api/auth/register') {
            $auth->register((string)($input['name'] ?? ''), (string)($input['email'] ?? ''));
            json_response(['message' => 'Verification code sent. Check your email.', 'redirect' => app_url('verify')], 201);
        }
        if ($path === '/api/auth/login') {
            $auth->requestLoginCode((string)($input['email'] ?? ''));
            json_response(['message' => 'If an account is registered with that address, a verification code has been sent.', 'verify_path' => app_url('verify')]);
        }
        if ($path === '/api/auth/password-login') {
            $auth->loginWithPassword((string)($input['email'] ?? ''), (string)($input['password'] ?? ''));
            json_response(['message' => 'Signed in.', 'redirect' => app_url('')]);
        }
        if ($path === '/api/auth/verify') {
            $user = $auth->verifyCode((string)($input['code'] ?? ''));
            json_response(['message' => 'Signed in.', 'redirect' => app_url(''), 'user' => ['name' => $user['display_name'], 'roles' => $user['roles']]]);
        }
        if ($path === '/api/auth/resend') {
            $auth->resendCode();
            json_response(['message' => 'If a verification request is available, a new code has been sent.']);
        }
        $auth->logout();
        json_response(['redirect' => app_url('login')]);
    }

    if ($path === '/assessment/take' && $method === 'GET') {
        require AKADEMI_ROOT . DIRECTORY_SEPARATOR . 'app' . DIRECTORY_SEPARATOR . 'Views' . DIRECTORY_SEPARATOR . 'assessment-take.php';
        exit;
    }
    if ($path === '/presentation/follow' && $method === 'GET') {
        require AKADEMI_ROOT . DIRECTORY_SEPARATOR . 'app' . DIRECTORY_SEPARATOR . 'Views' . DIRECTORY_SEPARATOR . 'presentation-follow.php';
        exit;
    }
    if (preg_match('#^/api/presentation-simulations/([a-fA-F0-9]{64})$#D', $path, $matches) && $method === 'GET') {
        json_response((new \Akademi\Services\PresentationSimulationService())->read(
            $matches[1],
            isset($_GET['participant_id']) ? (string)$_GET['participant_id'] : null
        ));
    }
    if (preg_match('#^/api/presentation-simulations/([a-fA-F0-9]{64})/join$#D', $path, $matches) && $method === 'POST') {
        json_response((new \Akademi\Services\PresentationSimulationService())->join($matches[1], request_json()));
    }
    if (preg_match('#^/api/presentation-simulations/([a-fA-F0-9]{64})/interaction$#D', $path, $matches) && $method === 'POST') {
        json_response((new \Akademi\Services\PresentationSimulationService())->interact($matches[1], request_json()));
    }
    if (preg_match('#^/api/student/assessment/info/([a-fA-F0-9]{64})$#D', $path, $matches) && $method === 'GET') {
        json_response(['assessment' => (new OnlineAssessmentService())->publicInfo($matches[1])]);
    }
    if ($path === '/api/student/assessment/roster' && $method === 'GET') {
        json_response((new OnlineAssessmentService())->rosterSuggestions(
            (string)($_GET['assessment'] ?? ''), (int)($_GET['class_id'] ?? 0), (string)($_GET['q'] ?? '')
        ));
    }
    if ($path === '/api/student/assessment/enroll' && $method === 'POST') {
        Csrf::verifyRequest();
        $input = request_json();
        json_response(['attempt' => (new OnlineAssessmentService())->enrollAndStart(
            (string)($input['assessment'] ?? ''), (int)($input['class_id'] ?? 0),
            (int)($input['learner_id'] ?? 0), (string)($input['access_code'] ?? '')
        )]);
    }
    if ($path === '/api/student/assessment/start' && $method === 'POST') {
        Csrf::verifyRequest();
        $input = request_json();
        json_response(['attempt' => (new OnlineAssessmentService())->start(
            (string)($input['code'] ?? ''), isset($input['assessment']) ? (string)$input['assessment'] : null
        )]);
    }
    if ($path === '/api/student/assessment/preview' && $method === 'POST') {
        Csrf::verifyRequest();
        $input = request_json();
        json_response(['preview' => (new OnlineAssessmentService())->preview(
            (string)($input['code'] ?? ''), isset($input['assessment']) ? (string)$input['assessment'] : null
        )]);
    }
    if ($path === '/api/student/assessment/current' && $method === 'GET') {
        json_response(['attempt' => (new OnlineAssessmentService())->current()]);
    }
    if ($path === '/api/student/assessment/save' && $method === 'POST') {
        Csrf::verifyRequest();
        $input = request_json();
        if (!is_array($input['answers'] ?? null)) {
            throw new RuntimeException('Assessment answers are missing or invalid.', 422);
        }
        $timedOutQuestions = $input['timed_out_questions'] ?? [];
        if (!is_array($timedOutQuestions)) {
            throw new RuntimeException('The timed-out question list is invalid.', 422);
        }
        json_response((new OnlineAssessmentService())->saveDraft($input['answers'], $timedOutQuestions));
    }

    if ($path === '/api/student/assessment/submit' && $method === 'POST') {
        Csrf::verifyRequest();
        $input = request_json();
        if (!is_array($input['answers'] ?? null)) {
            throw new RuntimeException('Assessment answers are missing or invalid.', 422);
        }
        $timedOutQuestions = $input['timed_out_questions'] ?? [];
        if (!is_array($timedOutQuestions)) {
            throw new RuntimeException('The timed-out question list is invalid.', 422);
        }
        json_response((new OnlineAssessmentService())->submit($input['answers'], $timedOutQuestions));
    }
    if ($path === '/api/student/assessment/results' && $method === 'GET') {
        json_response((new OnlineAssessmentService())->studentResults());
    }
    if ($path === '/api/student/assessment/events' && $method === 'POST') {
        Csrf::verifyRequest();
        $input = request_json();
        (new OnlineAssessmentService())->recordEvent((string)($input['event_type'] ?? ''));
        json_response(['recorded' => true]);
    }
    if ($path === '/api/teacher/online-assessments' && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireAnyRole($user, ['teacher', 'admin', 'superadmin']);
        json_response((new OnlineAssessmentService())->publish((int)$user['id'], request_json()), 201);
    }
    if ($path === '/api/teacher/assessment-classes' && $method === 'GET') {
        $user = require_user($auth);
        $auth->requireAnyRole($user, ['teacher', 'admin', 'superadmin']);
        json_response((new OnlineAssessmentService())->listClasses((int)$user['id']));
    }
    if ($path === '/api/teacher/assessment-classes' && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireAnyRole($user, ['teacher', 'admin', 'superadmin']);
        json_response((new OnlineAssessmentService())->saveClass((int)$user['id'], request_json()), 201);
    }
    if (preg_match('#^/api/teacher/assessment-classes/([1-9][0-9]*)$#D', $path, $matches) && $method === 'DELETE') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireAnyRole($user, ['teacher', 'admin', 'superadmin']);
        json_response((new OnlineAssessmentService())->deleteClass((int)$user['id'], (int)$matches[1]));
    }
    if (preg_match('#^/api/teacher/assessment-classes/([1-9][0-9]*)/restore$#D', $path, $matches) && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireAnyRole($user, ['teacher', 'admin', 'superadmin']);
        json_response((new OnlineAssessmentService())->restoreClass((int)$user['id'], (int)$matches[1]));
    }
    if (preg_match('#^/api/teacher/assessment-classes/([1-9][0-9]*)/learners/([1-9][0-9]*)/performance$#D', $path, $matches) && $method === 'GET') {
        $user = require_user($auth);
        $auth->requireAnyRole($user, ['teacher', 'admin', 'superadmin']);
        json_response((new OnlineAssessmentService())->learnerPerformance((int)$user['id'], (int)$matches[1], (int)$matches[2]));
    }
    if (preg_match('#^/api/teacher/online-assessments/([1-9][0-9]*)/roster$#D', $path, $matches) && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireAnyRole($user, ['teacher', 'admin', 'superadmin']);
        $input = request_json();
        if (!is_array($input['students'] ?? null)) {
            throw new RuntimeException('Provide the updated learner roster.', 422);
        }
        $canManageAny = array_intersect(['admin', 'superadmin'], $user['roles'] ?? []) !== [];
        json_response((new OnlineAssessmentService())->updateRoster((int)$user['id'], (int)$matches[1], $input['students'], $canManageAny));
    }
    if (preg_match('#^/api/teacher/online-assessments/([1-9][0-9]*)/availability$#D', $path, $matches) && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireAnyRole($user, ['teacher', 'admin', 'superadmin']);
        $input = request_json();
        $days = isset($input['duration_days']) ? filter_var($input['duration_days'], FILTER_VALIDATE_INT) : null;
        if (isset($input['duration_days']) && $days === false) throw new RuntimeException('Set the availability duration as a whole number of days.', 422);
        json_response((new OnlineAssessmentService())->updateAvailability((int)$user['id'], (int)$matches[1], (string)($input['action'] ?? ''), $days === false ? null : $days));
    }
    if (preg_match('#^/api/teacher/online-assessments/([1-9][0-9]*)/classes/([1-9][0-9]*)/availability$#D', $path, $matches) && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireAnyRole($user, ['teacher', 'admin', 'superadmin']);
        $canManageAny = array_intersect(['admin', 'superadmin'], $user['roles'] ?? []) !== [];
        $input = request_json();
        json_response((new OnlineAssessmentService())->updateClassAvailability(
            (int)$user['id'],
            (int)$matches[1],
            (int)$matches[2],
            (string)($input['action'] ?? ''),
            $canManageAny
        ));
    }
    if (preg_match('#^/api/teacher/online-assessments/([1-9][0-9]*)/learners/([1-9][0-9]*)/reset-access$#D', $path, $matches) && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireAnyRole($user, ['teacher', 'admin', 'superadmin']);
        $canManageAny = array_intersect(['admin', 'superadmin'], $user['roles'] ?? []) !== [];
        json_response((new OnlineAssessmentService())->resetLearnerAccess(
            (int)$user['id'],
            (int)$matches[1],
            (int)$matches[2],
            $canManageAny
        ));
    }
    if (preg_match('#^/api/admin/online-assessments/([1-9][0-9]*)/publish-results$#D', $path, $matches) && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireAnyRole($user, ['admin', 'superadmin']);
        json_response((new OnlineAssessmentService())->publishResultsAsAdmin((int)$matches[1]));
    }
    if ($path === '/api/teacher/online-assessments' && $method === 'GET') {
        $user = require_user($auth);
        $auth->requireAnyRole($user, ['teacher', 'admin', 'superadmin']);
        $canManageAny = array_intersect(['admin', 'superadmin'], $user['roles'] ?? []) !== [];
        json_response((new OnlineAssessmentService())->listForOwner((int)$user['id'], $canManageAny));
    }
    if (preg_match('#^/api/teacher/online-assessments/([1-9][0-9]*)$#D', $path, $matches) && $method === 'GET') {
        $user = require_user($auth);
        $auth->requireAnyRole($user, ['teacher', 'admin', 'superadmin']);
        $service = new OnlineAssessmentService();
        $service->processExpiredResults();
        $canManageAny = array_intersect(['admin', 'superadmin'], $user['roles'] ?? []) !== [];
        json_response($service->results((int)$user['id'], (int)$matches[1], $canManageAny));
    }
    if (preg_match('#^/api/teacher/online-assessments/([1-9][0-9]*)/scoresheet/email$#D', $path, $matches) && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireAnyRole($user, ['teacher', 'admin', 'superadmin']);
        $canManageAny = array_intersect(['admin', 'superadmin'], $user['roles'] ?? []) !== [];
        json_response((new OnlineAssessmentService())->emailScoreSheet((int)$user['id'], (int)$matches[1], $canManageAny));
    }
    if (preg_match('#^/api/teacher/online-assessment-attempts/([1-9][0-9]*)/grade$#D', $path, $matches) && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireAnyRole($user, ['teacher', 'admin', 'superadmin']);
        $input = request_json();
        $manualScore = filter_var($input['manual_score'] ?? null, FILTER_VALIDATE_INT);
        if ($manualScore === false) {
            throw new RuntimeException('Enter a whole-number written-response score.', 422);
        }
        $questionReviews = $input['question_reviews'] ?? [];
        if (!is_array($questionReviews)) {
            throw new RuntimeException('Provide a valid written-question review.', 422);
        }
        json_response((new OnlineAssessmentService())->grade((int)$user['id'], (int)$matches[1], $manualScore, $questionReviews));
    }
    if (preg_match('#^/api/teacher/online-assessment-attempts/([1-9][0-9]*)/integrity-review$#D', $path, $matches) && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireAnyRole($user, ['teacher', 'admin', 'superadmin']);
        $input = request_json();
        $decision = $input['decision'] ?? null;
        $marksDeducted = filter_var($input['marks_deducted'] ?? null, FILTER_VALIDATE_INT);
        $reason = $input['reason'] ?? null;
        if (!is_string($decision) || $marksDeducted === false || !is_string($reason)) {
            throw new RuntimeException('Provide a review decision, whole-number deduction, and reason.', 422);
        }
        $canManageAny = array_intersect(['admin', 'superadmin'], $user['roles'] ?? []) !== [];
        json_response((new OnlineAssessmentService())->reviewIntegrityMarks(
            (int)$user['id'],
            (int)$matches[1],
            $decision,
            $marksDeducted,
            $reason,
            $canManageAny
        ));
    }
    if (preg_match('#^/api/teacher/online-assessments/([1-9][0-9]*)/questions/([0-9]{1,2})$#D', $path, $matches) && $method === 'PUT') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireAnyRole($user, ['teacher', 'admin', 'superadmin']);
        $input = request_json();
        if (!is_array($input['question'] ?? null)) {
            throw new RuntimeException('Provide the replacement assessment question.', 422);
        }
        json_response((new OnlineAssessmentService())->replaceQuestion(
            (int)$user['id'],
            (int)$matches[1],
            (int)$matches[2],
            $input['question']
        ));
    }

    if ($path === '/api/account/password' && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $input = request_json();
        $newPassword = (string)($input['new_password'] ?? '');
        $confirmPassword = (string)($input['confirm_password'] ?? '');
        if (!hash_equals($newPassword, $confirmPassword)) {
            throw new RuntimeException('The new password and confirmation do not match.', 422);
        }
        $auth->setPassword((int)$user['id'], (string)($input['current_password'] ?? ''), $newPassword);
        json_response(['message' => 'Password saved. You can now sign in with your email and password.']);
    }

    if ($path === '/api/me' && $method === 'GET') {
        $user = require_user($auth);
        json_response(['user' => [
            'id' => (int)$user['id'],
            'display_name' => $user['display_name'],
            'email' => $user['email'],
            'roles' => $user['roles'],
        ], 'csrf_token' => Csrf::token()]);
    }

    if ($path === '/api/workspace' && $method === 'GET') {
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        json_response((new WorkspaceService())->load((int)$user['id'], $user));
    }

    if ($path === '/api/workspace/profile' && $method === 'PUT') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        json_response(['profile' => (new WorkspaceService())->saveProfile((int)$user['id'], request_json())]);
    }

    if ($path === '/api/workspace/profile/logo' && in_array($method, ['GET', 'POST'], true)) {
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        $workspace = new WorkspaceService();
        if ($method === 'POST') {
            Csrf::verifyRequest();
            if (!isset($_FILES['logo']) || !is_array($_FILES['logo'])) {
                throw new RuntimeException('Choose a school logo image to upload.', 422);
            }
            json_response($workspace->saveProfileLogo((int)$user['id'], $_FILES['logo']));
        }
        $logo = $workspace->profileLogo((int)$user['id']);
        header('Content-Type: ' . $logo['mime_type']);
        header('Content-Length: ' . (string)filesize($logo['path']));
        header('Content-Disposition: inline; filename="school-logo"');
        header('Cache-Control: private, no-store');
        header('X-Content-Type-Options: nosniff');
        readfile($logo['path']);
        exit;
    }

    if ($path === '/api/workspace/documents' && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        json_response(['document' => (new WorkspaceService())->createDocument((int)$user['id'], request_json())], 201);
    }

    if ($path === '/api/teacher/presentation-simulations' && $method === 'GET') {
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        json_response((new \Akademi\Services\PresentationSimulationService())->history((int)$user['id']));
    }

    if ($path === '/api/teacher/presentation-simulations' && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        json_response(
            (new \Akademi\Services\PresentationSimulationService())->create((int)$user['id'], request_json()),
            201
        );
    }

    if (preg_match('#^/api/teacher/presentation-simulations/([1-9][0-9]*)$#D', $path, $matches) && $method === 'PUT') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        json_response((new \Akademi\Services\PresentationSimulationService())->update(
            (int)$user['id'],
            (int)$matches[1],
            request_json()
        ));
    }
    if (preg_match('#^/api/teacher/presentation-simulations/([1-9][0-9]*)$#D', $path, $matches) && $method === 'GET') {
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        json_response((new \Akademi\Services\PresentationSimulationService())->ownerState(
            (int)$user['id'],
            (int)$matches[1]
        ));
    }
    if (preg_match('#^/api/teacher/presentation-simulations/([1-9][0-9]*)/student-link$#D', $path, $matches) && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        $input = request_json();
        json_response((new \Akademi\Services\PresentationSimulationService())->studentLink(
            (int)$user['id'],
            (int)$matches[1],
            $input['token'] ?? null
        ));
    }
    if (preg_match('#^/api/teacher/presentation-simulations/([1-9][0-9]*)/history$#D', $path, $matches) && $method === 'GET') {
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        json_response((new \Akademi\Services\PresentationSimulationService())->historyDetails(
            (int)$user['id'],
            (int)$matches[1]
        ));
    }
    if (preg_match('#^/api/teacher/presentation-simulations/([1-9][0-9]*)/questions/([1-9][0-9]*)$#D', $path, $matches) && $method === 'PUT') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        $input = request_json();
        json_response((new \Akademi\Services\PresentationSimulationService())->replyToQuestion(
            (int)$user['id'],
            (int)$matches[1],
            (int)$matches[2],
            $input['feedback'] ?? null
        ));
    }

    if (preg_match('#^/api/workspace/documents/([1-9][0-9]*)$#', $path, $matches) && $method === 'PUT') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        json_response([
            'document' => (new WorkspaceService())->updateDocument((int)$user['id'], (int)$matches[1], request_json()),
        ]);
    }

    if (preg_match('#^/api/workspace/documents/([1-9][0-9]*)$#', $path, $matches) && $method === 'DELETE') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        (new WorkspaceService())->deleteDocument((int)$user['id'], (int)$matches[1]);
        json_response(['deleted' => true]);
    }

    if (preg_match('#^/api/workspace/documents/([1-9][0-9]*)/archive$#D', $path, $matches) && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        $input = request_json();
        if (!is_bool($input['archived'] ?? null)) {
            throw new RuntimeException('Choose whether to archive or restore the document.', 422);
        }
        json_response(['document' => (new WorkspaceService())->setDocumentArchived(
            (int)$user['id'],
            (int)$matches[1],
            $input['archived']
        )]);
    }

    if ($path === '/api/workspace/schedule' && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        json_response(['entry' => (new WorkspaceService())->createScheduleEntry((int)$user['id'], request_json())], 201);
    }

    if (preg_match('#^/api/workspace/schedule/([1-9][0-9]*)$#D', $path, $matches) && $method === 'PUT') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        json_response(['entry' => (new WorkspaceService())->updateScheduleEntry((int)$user['id'], (int)$matches[1], request_json())]);
    }

    if (preg_match('#^/api/workspace/schedule/([1-9][0-9]*)$#', $path, $matches) && $method === 'DELETE') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        (new WorkspaceService())->deleteScheduleEntry((int)$user['id'], (int)$matches[1]);
        json_response(['deleted' => true]);
    }

    if ($path === '/api/admin/credits' && $method === 'GET') {
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        $creditSettings = new AiCreditService();
        $allowance = $creditSettings->monthlyAllowance();
        $month = gmdate('Y-m');
        $usage = Connection::get()->prepare(
            "SELECT COUNT(*) AS requests, COALESCE(SUM(credits), 0) AS credits
             FROM ai_credit_ledger
             WHERE DATE_FORMAT(created_at, '%Y-%m') = :month
               AND status = 'completed' AND quota_exempt = 0"
        );
        $usage->execute(['month' => $month]);
        json_response([
            'configured' => $creditSettings->monthlyAllowanceConfigured(),
            'monthly_allowance' => $allowance,
            'month' => $month,
            'usage' => $usage->fetch(),
        ]);
    }

    if ($path === '/api/admin/mail' && $method === 'GET') {
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        json_response((new \Akademi\Services\MailSettingsService())->publicConfig());
    }

    if ($path === '/api/admin/mail' && $method === 'PUT') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        json_response((new \Akademi\Services\MailSettingsService())->save(request_json(), (int)$user['id']));
    }

    if ($path === '/api/admin/mail/test' && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        $input = request_json();
        $mailConfig = (new \Akademi\Services\MailSettingsService())->publicConfig();
        $recipient = trim((string)($input['recipient'] ?? '')) ?: (string)$mailConfig['from_address'];
        if (filter_var($recipient, FILTER_VALIDATE_EMAIL) === false) {
            throw new RuntimeException('Enter a valid test-recipient email address.', 422);
        }
        Mailer::sendTestMessage((string)$recipient);
        json_response([
            'accepted' => true,
            'recipient' => $recipient,
            'sender' => (string)$mailConfig['from_address'],
            'delivery_status' => 'accepted_by_smtp',
        ]);
    }

    if ($path === '/api/admin/credits' && $method === 'PUT') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        $input = request_json();
        $allowance = filter_var($input['monthly_allowance'] ?? null, FILTER_VALIDATE_INT);
        if ($allowance === false) {
            throw new RuntimeException('Enter a whole-number monthly credit allowance.', 422);
        }
        json_response(['monthly_allowance' => (new AiCreditService())->updateMonthlyAllowance($allowance, (int)$user['id'])]);
    }

    if ($path === '/api/curriculum/resources' && $method === 'GET') {
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        $page = filter_var($_GET['page'] ?? 1, FILTER_VALIDATE_INT);
        if ($page === false || $page < 1) {
            throw new RuntimeException('Choose a valid resource page.', 422);
        }
        json_response((new CurriculumReviewService())->verifiedDocuments(
            $page,
            (string)($_GET['q'] ?? ''),
            (string)($_GET['year_group'] ?? '')
        ));
    }

    if (preg_match('#^/api/curriculum/resources/([1-9][0-9]*)$#D', $path, $matches) && $method === 'GET') {
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        $offset = filter_var($_GET['offset'] ?? 0, FILTER_VALIDATE_INT);
        if ($offset === false || $offset < 0) {
            throw new RuntimeException('Resource section offset must be a non-negative number.', 422);
        }
        json_response((new CurriculumReviewService())->reader((int)$matches[1], $offset, true));
    }

    if (preg_match('#^/api/curriculum/resources/([1-9][0-9]*)/file$#D', $path, $matches) && $method === 'GET') {
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        $file = (new CurriculumReviewService())->originalPdf((int)$matches[1], true);
        header('Content-Type: application/pdf');
        header('Content-Disposition: inline; filename="resource.pdf"; filename*=UTF-8\'\'' . rawurlencode($file['filename']));
        header('Content-Length: ' . (string)$file['bytes']);
        header('Cache-Control: private, no-store, max-age=0');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        readfile($file['path']);
        exit;
    }

    if (preg_match('#^/api/curriculum/resources/([1-9][0-9]*)/source$#D', $path, $matches) && $method === 'GET') {
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        serve_curriculum_resource((new CurriculumReviewService())->originalResource((int)$matches[1], true), ($_GET['download'] ?? '') === '1');
    }

    if ($path === '/api/curriculum/search' && $method === 'GET') {
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        $query = trim((string)($_GET['q'] ?? ''));
        $yearGroup = (string)($_GET['year_group'] ?? '');
        if ($yearGroup !== '' && !in_array($yearGroup, ['SHS1', 'SHS2', 'SHS3'], true)) {
            throw new RuntimeException('Choose a valid SHS year group.', 422);
        }
        json_response(['sources' => (new CurriculumSearchService())->search($query, $yearGroup ?: null)]);
    }

    if ($path === '/api/curriculum/structure' && $method === 'GET') {
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        $yearGroup = (string)($_GET['year_group'] ?? '');
        if ($yearGroup !== '' && !in_array($yearGroup, ['SHS1', 'SHS2', 'SHS3'], true)) {
            throw new RuntimeException('Choose a valid SHS year group.', 422);
        }
        $offset = filter_var($_GET['offset'] ?? 0, FILTER_VALIDATE_INT);
        if ($offset === false || $offset < 0) {
            throw new RuntimeException('Batch offset must be a non-negative number.', 422);
        }
        $sections = (new CurriculumSearchService())->verifiedStructure(
            $yearGroup !== '' ? $yearGroup : null,
            (string)($_GET['q'] ?? ''),
            100,
            $offset,
            trim((string)($_GET['subject'] ?? ''))
        );
        json_response(['sections' => $sections, 'next_offset' => count($sections) === 100 ? $offset + 100 : null]);
    }

    if ($path === '/api/curriculum/weekly-lessons' && $method === 'GET') {
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        $subject = trim((string)($_GET['subject'] ?? ''));
        $yearGroup = (string)($_GET['year_group'] ?? '');
        $semesterValue = $_GET['semester'] ?? null;
        $semester = $semesterValue === null || $semesterValue === ''
            ? null
            : filter_var($semesterValue, FILTER_VALIDATE_INT);
        if ($semester === false) {
            throw new RuntimeException('Choose first semester or second semester.', 422);
        }
        json_response([
            'lessons' => (new CurriculumSearchService())->verifiedWeeklyLessons(
                $subject,
                $yearGroup,
                $semester,
                500,
                ($_GET['include_structure'] ?? '') === '1'
            ),
        ]);
    }

    if ($path === '/api/curriculum/discover-weekly-lessons' && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        $input = request_json();
        $semesterValue = $input['semester'] ?? null;
        $semester = $semesterValue === null || $semesterValue === ''
            ? null
            : filter_var($semesterValue, FILTER_VALIDATE_INT);
        if ($semester === false) {
            throw new RuntimeException('Choose first semester or second semester.', 422);
        }
        $result = (new CurriculumTopicDiscoveryService())->discover(
            trim((string)($input['subject'] ?? '')),
            (string)($input['year_group'] ?? ''),
            $semester
        );
        $result['credits'] = (new AiCreditService())->balance((int)$user['id']);
        json_response($result);
    }

    if ($path === '/api/ai/status' && $method === 'GET') {
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        json_response([
            'ai_provider' => (new AiProviderService())->publicConfig(),
            'credits' => (new AiCreditService())->balance((int)$user['id']),
            'quota_exempt' => in_array('superadmin', $user['roles'], true),
        ]);
    }

    if ($path === '/api/ai/presentation-visual' && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        $input = request_json();
        $credits = new AiCreditService();
        $reservationId = $credits->reserve(
            (int)$user['id'],
            'presentation_visual',
            in_array('superadmin', $user['roles'], true)
        );
        try {
            $visual = (new AiProviderService())->generatePresentationVisual($input);
            $credits->complete($reservationId);
            json_response(['visual' => $visual, 'credits' => $credits->balance((int)$user['id'])]);
        } catch (Throwable $exception) {
            $credits->refund($reservationId);
            throw $exception;
        }
    }

    if ($path === '/api/ai/generate' && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'teacher');
        $input = request_json();
        $type = (string)($input['type'] ?? '');
        if (!in_array($type, ['lesson', 'assessment', 'scheme', 'slides'], true)) {
            throw new RuntimeException('Choose a supported draft type before generating.', 422);
        }
        $yearGroup = (string)($input['year_group'] ?? '');
        if (!in_array($yearGroup, ['SHS1', 'SHS2', 'SHS3'], true)) {
            throw new RuntimeException('Choose a valid SHS year group before generating a draft.', 422);
        }
        $yearGroups = [$yearGroup];
        if ($type === 'assessment') {
            $requestedYears = $input['year_groups'] ?? [$yearGroup];
            if (!is_array($requestedYears) || $requestedYears === [] || count($requestedYears) > 3) {
                throw new RuntimeException('Choose one or more valid SHS years for the assessment.', 422);
            }
            $yearGroups = array_values(array_unique(array_filter($requestedYears, static fn(mixed $value): bool =>
                is_string($value) && in_array($value, ['SHS1', 'SHS2', 'SHS3'], true)
            )));
            if (count($yearGroups) !== count($requestedYears) || !in_array($yearGroup, $yearGroups, true)) {
                throw new RuntimeException('One or more selected SHS years are invalid.', 422);
            }
            $input['year_groups'] = $yearGroups;
        }
        if (trim((string)($input['subject'] ?? '')) === '') {
            throw new RuntimeException('Enter the subject before generating a draft.', 422);
        }
        $search = new CurriculumSearchService();
        $lessonSourceReference = null;
        if ($type === 'lesson') {
            $semesterNumber = filter_var($input['semester_number'] ?? null, FILTER_VALIDATE_INT);
            $weekNumber = filter_var($input['week_number'] ?? null, FILTER_VALIDATE_INT);
            if ($semesterNumber === false || $semesterNumber < 1 || $semesterNumber > 2
                || $weekNumber === false || $weekNumber < 1 || $weekNumber > 52) {
                throw new RuntimeException('Choose a verified semester and teaching week before generating a lesson.', 422);
            }
            $weeklyLessons = $search->verifiedWeeklyLessons(
                trim((string)$input['subject']),
                $yearGroup,
                $semesterNumber,
                500,
                true
            );
            $weeklyLesson = null;
            foreach ($weeklyLessons as $candidate) {
                if ((int)$candidate['week_number'] === $weekNumber) {
                    $weeklyLesson = $candidate;
                    break;
                }
            }
            if ($weeklyLesson === null) {
                throw new RuntimeException('The selected teaching week is no longer available in verified curriculum data. Reload the lesson planner and choose it again.', 422);
            }
            $lessonSourceReference = $search->verifiedWeeklyLessonSourceChunk(
                (int)$weeklyLesson['document_id'],
                (int)$weeklyLesson['source_chunk_id']
            );
            if ($lessonSourceReference === null) {
                throw new RuntimeException('The selected weekly curriculum source could not be verified. Reload the lesson planner and choose another week.', 422);
            }

            $entriesById = [];
            foreach ($weeklyLesson['curriculum_entries'] ?? [] as $entry) {
                $entriesById[(string)$entry['id']] = $entry;
            }
            $topicEntryId = 'weekly-topic-' . (int)$weeklyLesson['id'];
            $entriesById[$topicEntryId] = [
                'id' => $topicEntryId,
                'section_type' => 'topic',
                'title' => (string)$weeklyLesson['topic'],
                'body' => '',
            ];
            foreach ($weeklyLesson['focal_areas'] as $index => $focalArea) {
                $entryId = 'weekly-focal-' . (int)$weeklyLesson['id'] . '-' . $index;
                $entriesById[$entryId] = [
                    'id' => $entryId,
                    'section_type' => 'focal_area',
                    'title' => (string)$focalArea,
                    'body' => '',
                ];
            }
            $entryType = static function (array $entry): string {
                $typeName = strtolower((string)($entry['section_type'] ?? ''));
                $typeName = preg_replace('/[\s-]+/', '_', $typeName) ?? $typeName;
                if (in_array($typeName, [
                    'strand', 'sub_strand', 'focal_area', 'content_standard', 'topic',
                    'learning_indicator', 'learning_outcome', 'learning_objective',
                ], true)) {
                    return $typeName;
                }
                $source = (string)($entry['title'] ?? '') . "\n" . mb_substr((string)($entry['body'] ?? ''), 0, 600, 'UTF-8');
                $labels = [
                    '/^\s*(?:sub[\s_-]*strand)\s*(?:[:#-]|\d|\b)/imu' => 'sub_strand',
                    '/^\s*(?:focal[\s_-]*area)\s*(?:[:#-]|\d|\b)/imu' => 'focal_area',
                    '/^\s*(?:content[\s_-]*standard|standard)\s*(?:[:#-]|\d|\b)/imu' => 'content_standard',
                    '/^\s*(?:learning[\s_-]*(?:indicator|outcome)|indicator)\s*(?:[:#-]|\d|\b)/imu' => 'learning_indicator',
                    '/^\s*strand\s*(?:[:#-]|\d|\b)/imu' => 'strand',
                    '/^\s*topic\s*(?:[:#-]|\d|\b)/imu' => 'topic',
                ];
                foreach ($labels as $pattern => $label) {
                    if (preg_match($pattern, $source) === 1) {
                        return $label;
                    }
                }
                return $typeName;
            };
            $allowedTypes = [
                'strand' => ['strand'],
                'substrand' => ['sub_strand'],
                'focalArea' => ['focal_area'],
                'standard' => ['content_standard'],
                'topic' => ['topic'],
                'indicator' => ['learning_indicator', 'learning_outcome', 'learning_objective'],
            ];
            $selectionIds = $input['curriculum_entry_ids'] ?? [];
            if (!is_array($selectionIds)) {
                throw new RuntimeException('The selected weekly curriculum entries are invalid. Reload the lesson planner and try again.', 422);
            }
            $selectedEntries = [];
            foreach ($allowedTypes as $field => $types) {
                $requestedIds = $selectionIds[$field] ?? null;
                if (!is_array($requestedIds) || count($requestedIds) > 30) {
                    throw new RuntimeException('One or more selected weekly curriculum entries are invalid. Reload the lesson planner and try again.', 422);
                }
                $selectedEntries[$field] = [];
                foreach ($requestedIds as $requestedId) {
                    if (!is_string($requestedId) && !is_int($requestedId)) {
                        throw new RuntimeException('One or more selected weekly curriculum entries are invalid. Reload the lesson planner and try again.', 422);
                    }
                    $entry = $entriesById[(string)$requestedId] ?? null;
                    if ($entry === null || !in_array($entryType($entry), $types, true)) {
                        throw new RuntimeException('A selected curriculum entry does not belong to the chosen teaching week. Reload the lesson planner and try again.', 422);
                    }
                    $selectedEntries[$field][] = $entry;
                }
            }
            if ($selectedEntries['topic'] === [] || $selectedEntries['indicator'] === []) {
                throw new RuntimeException('Select the verified weekly topic and at least one linked learning indicator.', 422);
            }
            $formatEntry = static function (array $entry, bool $includeBody = false): string {
                $text = implode(' · ', array_filter([
                    trim((string)($entry['code'] ?? '')),
                    trim((string)($entry['title'] ?? '')),
                ]));
                if ($includeBody && trim((string)($entry['body'] ?? '')) !== '') {
                    $text .= "\n" . mb_substr(trim((string)$entry['body']), 0, 500, 'UTF-8');
                }
                return $text;
            };
            $firstEntry = static fn(array $entries, bool $includeBody = false): string =>
                $entries === [] ? '' : $formatEntry($entries[0], $includeBody);
            $input['topic'] = (string)$weeklyLesson['topic'];
            $input['strand'] = $firstEntry($selectedEntries['strand']);
            $input['sub_strand'] = $firstEntry($selectedEntries['substrand']);
            $input['focal_areas'] = array_map(
                static fn(array $entry): string => $formatEntry($entry),
                $selectedEntries['focalArea']
            );
            $input['focal_area'] = implode('; ', $input['focal_areas']);
            $input['learning_indicators'] = array_map(
                static fn(array $entry): string => $formatEntry($entry, true),
                array_values(array_filter(
                    $selectedEntries['indicator'],
                    static fn(array $entry): bool => in_array($entryType($entry), ['learning_indicator', 'learning_objective'], true)
                ))
            );
            $input['learning_outcomes'] = array_map(
                static fn(array $entry): string => $formatEntry($entry, true),
                array_values(array_filter(
                    $selectedEntries['indicator'],
                    static fn(array $entry): bool => $entryType($entry) === 'learning_outcome'
                ))
            );
            $input['curriculum_reference'] = (string)($weeklyLesson['source_reference'] ?: $weeklyLesson['source_title']);
            $input['week_label'] = 'Semester ' . $semesterNumber . ' · Week ' . $weekNumber;
            $input['semester_number'] = $semesterNumber;
            $input['week_number'] = $weekNumber;
            $lessonCount = filter_var($input['number_of_lessons'] ?? 1, FILTER_VALIDATE_INT);
            if ($lessonCount === false || $lessonCount < 1 || $lessonCount > 10) {
                throw new RuntimeException('Choose between 1 and 10 lessons for the teaching week.', 422);
            }
            $input['number_of_lessons'] = $lessonCount;
            $standardAssignments = array_fill(0, $lessonCount, []);
            foreach ($selectedEntries['standard'] as $index => $standard) {
                $standardAssignments[$index % $lessonCount][] = $formatEntry($standard, true);
            }
            if ($selectedEntries['standard'] !== []) {
                foreach ($standardAssignments as $index => &$standards) {
                    if ($standards === []) {
                        $standards[] = $formatEntry($selectedEntries['standard'][$index % count($selectedEntries['standard'])], true);
                    }
                }
                unset($standards);
            }
            $input['content_standards'] = array_values(array_merge(...$standardAssignments));
            $input['content_standard_assignments'] = [];
            foreach ($standardAssignments as $index => $standards) {
                if ($standards !== []) {
                    $input['content_standard_assignments'][] = [
                        'lesson_number' => $index + 1,
                        'standards' => $standards,
                    ];
                }
            }
            $input['content_standard'] = implode("\n", array_map(
                static fn(array $assignment): string =>
                    'Lesson ' . $assignment['lesson_number'] . ': ' . implode('; ', $assignment['standards']),
                $input['content_standard_assignments']
            ));
            $duration = filter_var($input['duration_minutes'] ?? null, FILTER_VALIDATE_INT);
            if ($duration === false || $duration < 10 || $duration > 300) {
                throw new RuntimeException('Choose a lesson duration between 10 and 300 minutes.', 422);
            }
        }
        if ($type === 'scheme' && trim((string)($input['academic_year'] ?? '')) === '') {
            throw new RuntimeException('Enter the academic year before generating a scheme of work.', 422);
        }
        if ($type === 'scheme' && mb_strlen(trim((string)$input['academic_year'])) > 30) {
            throw new RuntimeException('Keep the academic year within 30 characters.', 422);
        }
        if ($type === 'scheme') {
            $input['scheme_period'] = (string)($input['scheme_period'] ?? 'full_year');
            if (!in_array($input['scheme_period'], ['semester', 'full_year'], true)) {
                throw new RuntimeException('Choose one semester or the full academic year.', 422);
            }
            if ($input['scheme_period'] === 'semester') {
                $semesterNumber = filter_var($input['semester_number'] ?? $input['term_number'] ?? null, FILTER_VALIDATE_INT);
                if ($semesterNumber === false || $semesterNumber < 1 || $semesterNumber > 2) {
                    throw new RuntimeException('Choose first semester or second semester.', 422);
                }
                $input['semester_number'] = $semesterNumber;
                unset($input['term_number']);
            } else {
                unset($input['semester_number'], $input['term_number']);
            }
            $subject = trim((string)$input['subject']);
            $input['teaching_week_counts'] = [];
            foreach ([1, 2] as $semester) {
                $semesterLessons = $search->verifiedWeeklyLessons($subject, $yearGroup, $semester, 500);
                $sourceWeekNumbers = array_filter(
                    array_map(static fn(array $lesson): int => (int)$lesson['week_number'], $semesterLessons),
                    static fn(int $week): bool => $week >= 1 && $week <= 52
                );
                $input['teaching_week_counts'][$semester] = $sourceWeekNumbers === []
                    ? 12
                    : max($sourceWeekNumbers);
            }
            if ($input['scheme_period'] === 'semester') {
                $input['teaching_weeks_per_semester'] = $input['teaching_week_counts'][$input['semester_number']];
            }
        }
        if ($type === 'assessment') {
            $assessmentTypes = ['class_exercise', 'mid_semester', 'end_of_semester', 'mock'];
            $questionFormats = ['mixed', 'mcq', 'worked', 'extended', 'brief', 'other'];
            if (!in_array($input['assessment_type'] ?? '', $assessmentTypes, true)
                || !in_array($input['question_format'] ?? '', $questionFormats, true)) {
                throw new RuntimeException('Choose a valid assessment type and question format.', 422);
            }
            if (($input['question_format'] ?? '') === 'other' && trim((string)($input['other_format'] ?? '')) === '') {
                throw new RuntimeException('Describe the requested question format.', 422);
            }
            if (filter_var($input['total_marks'] ?? null, FILTER_VALIDATE_INT) === false
                || (int)$input['total_marks'] < 1 || (int)$input['total_marks'] > 500) {
                throw new RuntimeException('Choose a total mark value between 1 and 500.', 422);
            }
            $questionCount = filter_var($input['question_count'] ?? null, FILTER_VALIDATE_INT);
            if ($questionCount === false || $questionCount < 1 || $questionCount > 100) {
                throw new RuntimeException('Choose a question count between 1 and 100.', 422);
            }
            if ($questionCount > (int)$input['total_marks']) {
                throw new RuntimeException('Total marks must be at least the number of questions.', 422);
            }
            $input['question_count'] = $questionCount;
            if (mb_strlen(trim((string)($input['assessment_title'] ?? ''))) > 190) {
                throw new RuntimeException('Keep the assessment title within 190 characters.', 422);
            }
            $duration = filter_var($input['duration_minutes'] ?? null, FILTER_VALIDATE_INT);
            if ($duration === false || $duration < 10 || $duration > 300) {
                throw new RuntimeException('Choose an assessment duration between 10 and 300 minutes.', 422);
            }
        }
        $selectedAssessmentTopics = [];
        if ($type === 'assessment' && isset($input['selected_topic_ids'])) {
            if (!is_array($input['selected_topic_ids'])) {
                throw new RuntimeException('Selected curriculum topics are invalid.', 422);
            }
            if (count($input['selected_topic_ids']) > 30) {
                throw new RuntimeException('Select no more than 30 curriculum topics for one assessment.', 422);
            }
            if ($input['selected_topic_ids'] !== []) {
                $selectedAssessmentTopics = $search->verifiedAssessmentTopics(
                    $input['selected_topic_ids'],
                    trim((string)$input['subject'])
                );
                foreach ($selectedAssessmentTopics as $topic) {
                    if (!in_array((string)$topic['year_group'], $yearGroups, true)) {
                        throw new RuntimeException('Selected curriculum topics must belong to one of the selected SHS years.', 422);
                    }
                }
                $input['selected_topics'] = array_map(static fn(array $row): array => [
                    'title' => (string)$row['selected_title'],
                    'section_type' => (string)$row['section_type'],
                    'year_group' => (string)$row['year_group'],
                    'parent_title' => $row['parent_title'] === null ? null : (string)$row['parent_title'],
                    'details' => (string)($row['selected_details'] ?? ''),
                ], $selectedAssessmentTopics);
            }
        }
        $weeklyLessonSourceReferences = [];
        if ($type === 'assessment') {
            $selectedWeeklySections = $input['selected_week_sections'] ?? [];
            if (!is_array($selectedWeeklySections) || count($selectedWeeklySections) > 117) {
                throw new RuntimeException('Select no more than 39 weekly sections for each selected SHS year.', 422);
            }
            foreach ($selectedWeeklySections as $section) {
                if (!is_array($section)) {
                    throw new RuntimeException('One or more selected assessment weeks are invalid.', 422);
                }
                if (!in_array(($section['year_group'] ?? ''), $yearGroups, true)) {
                    throw new RuntimeException('Selected teaching weeks must match one of the selected SHS years.', 422);
                }
            }
            $verifiedLessonsById = [];
            $hasResourceWeeks = array_filter(
                $selectedWeeklySections,
                static fn(array $section): bool => array_key_exists('weekly_lesson_id', $section)
            ) !== [];
            if ($hasResourceWeeks) {
                foreach ($yearGroups as $selectedYear) {
                    foreach ($search->verifiedWeeklyLessons(trim((string)$input['subject']), $selectedYear, null, 500, true) as $lesson) {
                        $verifiedLessonsById[(int)$lesson['id']] = $lesson;
                    }
                }
            }
            $input['selected_week_sections'] = array_map(
                static function (array $section) use ($verifiedLessonsById, $search, &$weeklyLessonSourceReferences): array {
                    if (!array_key_exists('weekly_lesson_id', $section)) {
                        return $section;
                    }
                    $lessonId = filter_var($section['weekly_lesson_id'], FILTER_VALIDATE_INT);
                    $lesson = $lessonId === false ? null : ($verifiedLessonsById[(int)$lessonId] ?? null);
                    if (!is_array($lesson)
                        || (int)($section['semester_number'] ?? 0) !== (int)$lesson['semester_number']
                        || (int)($section['week_number'] ?? $section['week'] ?? 0) !== (int)$lesson['week_number']
                        || strcasecmp(trim((string)($section['topic'] ?? '')), trim((string)$lesson['topic'])) !== 0) {
                        throw new RuntimeException(
                            'A selected assessment week is no longer available in verified curriculum data. Reload the week list and select it again.',
                            422
                        );
                    }
                    $entries = is_array($lesson['curriculum_entries'] ?? null) ? $lesson['curriculum_entries'] : [];
                    $entryTitles = static function (string $type) use ($entries): string {
                        $titles = array_map(
                            static fn(array $entry): string => trim((string)($entry['title'] ?? '')),
                            array_filter($entries, static fn(array $entry): bool => ($entry['section_type'] ?? '') === $type)
                        );
                        return implode('; ', array_filter($titles));
                    };
                    $sourceChunkId = (int)($lesson['source_chunk_id'] ?? 0);
                    if ($sourceChunkId > 0) {
                        $reference = $search->verifiedWeeklyLessonSourceChunk((int)$lesson['document_id'], $sourceChunkId);
                        if ($reference === null) {
                            throw new RuntimeException('A selected weekly curriculum source could not be verified. Reload the week list and choose it again.', 422);
                        }
                        $weeklyLessonSourceReferences[] = $reference;
                    }
                    return [
                        'year_group' => (string)$section['year_group'],
                        'term' => 'Semester ' . (int)$lesson['semester_number'],
                        'week' => (int)$lesson['week_number'],
                        'semester_number' => (int)$lesson['semester_number'],
                        'week_number' => (int)$lesson['week_number'],
                        'strand' => $entryTitles('strand'),
                        'sub_strand' => $entryTitles('sub_strand'),
                        'focal_area' => implode('; ', $lesson['focal_areas']),
                        'focal_areas' => array_values($lesson['focal_areas']),
                        'topic' => (string)$lesson['topic'],
                        'content_standard' => $entryTitles('content_standard'),
                        'learning_indicators' => array_values($lesson['learning_indicators']),
                        'learning_outcomes' => array_values($lesson['learning_outcomes']),
                        'learning_focus' => mb_substr(trim((string)($section['learning_focus'] ?? '')), 0, 220, 'UTF-8'),
                    ];
                },
                $selectedWeeklySections
            );
        }
        $queryFields = [
            $input['subject'] ?? '',
            $input['assessment_title'] ?? '',
            $input['topic'] ?? '',
            $input['strand'] ?? '',
            $input['sub_strand'] ?? '',
            $input['focal_area'] ?? '',
            $input['learning_indicators'] ?? '',
            $input['learning_outcomes'] ?? '',
        ];
        if ($type === 'assessment') {
            $queryFields[] = $input['scope'] ?? '';
            $queryFields[] = $input['teacher_instructions'] ?? '';
            $queryFields[] = $input['question_format'] ?? '';
            foreach (is_array($input['selected_week_sections'] ?? null) ? $input['selected_week_sections'] : [] as $weeklySection) {
                if (!is_array($weeklySection)) {
                    continue;
                }
                foreach (['term', 'week', 'strand', 'sub_strand', 'focal_area', 'topic', 'content_standard', 'learning_focus'] as $field) {
                    $queryFields[] = $weeklySection[$field] ?? '';
                }
                foreach (['focal_areas', 'learning_indicators', 'learning_outcomes'] as $field) {
                    foreach (is_array($weeklySection[$field] ?? null) ? $weeklySection[$field] : [] as $weeklyDetail) {
                        $queryFields[] = $weeklyDetail;
                    }
                }
            }
            foreach ($input['selected_topics'] ?? [] as $selectedTopic) {
                if (is_array($selectedTopic)) {
                    $queryFields[] = $selectedTopic['title'] ?? '';
                    $queryFields[] = $selectedTopic['parent_title'] ?? '';
                }
            }
        }
        if ($type === 'slides') {
            $rawSelectedWeeklySections = $input['selected_week_sections'] ?? [];
            if (!is_array($rawSelectedWeeklySections)) {
                throw new RuntimeException('Selected presentation weeks are invalid. Reload the week list and try again.', 422);
            }
            foreach ($rawSelectedWeeklySections as $section) {
                if (!is_array($section)) {
                    throw new RuntimeException('One or more selected presentation weeks are invalid. Reload the week list and try again.', 422);
                }
            }
            $selectedWeeklySections = array_values($rawSelectedWeeklySections);
            if (count($selectedWeeklySections) > 39) {
                throw new RuntimeException('Select no more than 39 weekly sections for one presentation.', 422);
            }
            if ($selectedWeeklySections !== []) {
                $verifiedLessons = $search->verifiedWeeklyLessons(
                    trim((string)$input['subject']),
                    $yearGroup,
                    null,
                    500,
                    true
                );
                $verifiedByWeek = [];
                foreach ($verifiedLessons as $lesson) {
                    $weekKey = (int)$lesson['semester_number'] . ':' . (int)$lesson['week_number'];
                    $verifiedByWeek[$weekKey] = $lesson;
                }
                $input['selected_week_sections'] = array_map(
                    static function (array $section) use ($verifiedByWeek): array {
                        $semester = (int)($section['semester_number'] ?? 0);
                        $weekNumber = (int)($section['week_number'] ?? 0);
                        $lesson = $verifiedByWeek[$semester . ':' . $weekNumber] ?? null;
                        if (!is_array($lesson)
                            || strcasecmp(trim((string)($section['topic'] ?? '')), trim((string)$lesson['topic'])) !== 0) {
                            throw new RuntimeException(
                                'A selected presentation week is no longer available in verified curriculum data. Reload the week list and select it again.',
                                422
                            );
                        }
                        $entries = is_array($lesson['curriculum_entries'] ?? null) ? $lesson['curriculum_entries'] : [];
                        $entryTitles = static function (string $type) use ($entries): array {
                            $values = [];
                            foreach ($entries as $entry) {
                                if (strtolower((string)($entry['section_type'] ?? '')) !== $type) {
                                    continue;
                                }
                                $title = trim((string)($entry['title'] ?? ''));
                                if ($title !== '') {
                                    $values[] = $title;
                                }
                            }
                            return array_values(array_unique($values));
                        };
                        return [
                            'semester_number' => (int)$lesson['semester_number'],
                            'week_number' => (int)$lesson['week_number'],
                            'topic' => (string)$lesson['topic'],
                            'strand' => $entryTitles('strand')[0] ?? '',
                            'sub_strand' => $entryTitles('sub_strand')[0] ?? '',
                            'content_standard' => $entryTitles('content_standard')[0] ?? '',
                            'focal_areas' => array_values($lesson['focal_areas']),
                            'learning_indicators' => array_values($lesson['learning_indicators']),
                            'learning_outcomes' => array_values($lesson['learning_outcomes']),
                            'source_title' => (string)$lesson['source_title'],
                            'source_reference' => (string)$lesson['source_reference'],
                            'source_page' => $lesson['source_page'] === null ? null : (int)$lesson['source_page'],
                        ];
                    },
                    $selectedWeeklySections
                );
            }
            foreach (is_array($input['selected_week_sections'] ?? null) ? $input['selected_week_sections'] : [] as $weeklySection) {
                if (!is_array($weeklySection)) {
                    continue;
                }
                foreach (['topic', 'strand', 'sub_strand', 'content_standard'] as $field) {
                    $queryFields[] = $weeklySection[$field] ?? '';
                }
                foreach (is_array($weeklySection['focal_areas'] ?? null) ? $weeklySection['focal_areas'] : [] as $focalArea) {
                    $queryFields[] = $focalArea;
                }
            }
        }
        if ($type === 'scheme') {
            $queryFields[] = $input['scheme_period'] === 'semester'
                ? 'scheme of work Semester ' . $input['semester_number']
                : 'scheme of work full academic year both semesters';
        }
        $query = implode(' ', array_filter(array_map(static function (mixed $value): string {
            if (is_array($value)) {
                return implode(' ', array_filter(array_map('strval', $value)));
            }
            return is_scalar($value) ? trim((string)$value) : '';
        }, $queryFields)));
        if ($type === 'slides' && $selectedAssessmentTopics === []) {
            $weeklySections = array_values(array_filter(
                is_array($input['selected_week_sections'] ?? null) ? $input['selected_week_sections'] : [],
                static fn(mixed $section): bool => is_array($section)
            ));
            $sampleCount = min(4, count($weeklySections));
            $selectedWeekReferences = [];
            for ($sample = 0; $sample < $sampleCount; $sample++) {
                $sectionIndex = (int)floor($sample * count($weeklySections) / $sampleCount);
                $section = $weeklySections[$sectionIndex];
                $sectionQuery = implode(' ', array_filter(array_map(
                    static fn(mixed $value): string => is_scalar($value) ? trim((string)$value) : '',
                    [
                        $input['subject'] ?? '',
                        $section['topic'] ?? '',
                        $section['strand'] ?? '',
                        $section['sub_strand'] ?? '',
                        $section['content_standard'] ?? '',
                        ...(is_array($section['focal_areas'] ?? null) ? $section['focal_areas'] : []),
                    ]
                )));
                foreach ($search->search($sectionQuery, $yearGroup, 1) as $reference) {
                    $referenceKey = (string)($reference['document_id'] ?? '') . ':' . (string)($reference['chunk_id'] ?? '');
                    $selectedWeekReferences[$referenceKey] = $reference;
                }
            }
            $references = array_slice(array_values($selectedWeekReferences), 0, 4);
        } else {
            if ($selectedAssessmentTopics !== []) {
                $references = $selectedAssessmentTopics;
            } elseif ($type === 'assessment') {
                $referencesBySource = [];
                foreach ($yearGroups as $selectedYear) {
                    foreach ($search->search($query, $selectedYear, 6, null, '') as $reference) {
                        $referenceKey = (int)($reference['document_id'] ?? 0) . ':' . (int)($reference['chunk_id'] ?? 0);
                        $referencesBySource[$referenceKey] = $reference;
                    }
                }
                $references = array_slice(array_values($referencesBySource), 0, 6);
            } else {
                $references = $search->search(
                    $query,
                    $yearGroup,
                    $type === 'scheme' ? 10 : 6,
                    null,
                    $type === 'lesson' ? trim((string)($input['subject'] ?? '')) : ''
                );
            }
        }
        if ($type === 'assessment' && $weeklyLessonSourceReferences !== []) {
            $uniqueReferences = [];
            foreach ([...$weeklyLessonSourceReferences, ...$references] as $reference) {
                $referenceKey = (int)($reference['document_id'] ?? 0) . ':' . (int)($reference['chunk_id'] ?? 0);
                $uniqueReferences[$referenceKey] = $reference;
            }
            $references = array_slice(array_values($uniqueReferences), 0, 6);
        }
        if ($type === 'lesson' && $lessonSourceReference !== null) {
            $sourceKey = (int)$lessonSourceReference['document_id'] . ':' . (int)$lessonSourceReference['chunk_id'];
            $references = array_values(array_filter(
                $references,
                static fn(array $reference): bool =>
                    ((int)($reference['document_id'] ?? 0) . ':' . (int)($reference['chunk_id'] ?? 0)) !== $sourceKey
            ));
            array_unshift($references, $lessonSourceReference);
            $references = array_slice($references, 0, 6);
        }
        $input['curriculum_fallback'] = $type === 'assessment'
            && $selectedAssessmentTopics === [];
        if ($input['curriculum_fallback']) {
            $catalogYears = $type === 'assessment' ? $yearGroups : [$yearGroup];
            $catalogEntries = [];
            foreach ($catalogYears as $selectedYear) {
                $catalogEntry = (new NaccaCurriculumCatalogService())->outline((string)($input['subject'] ?? ''), $selectedYear);
                $catalogEntries[$selectedYear] = [
                    'outline' => $catalogEntry['outline'],
                    'status' => $catalogEntry['status'],
                    'source_url' => $catalogEntry['source_url'],
                ];
            }
            if ($type === 'assessment' && count($catalogEntries) > 1) {
                $input['curriculum_catalog_by_year'] = $catalogEntries;
                $input['curriculum_catalog_outline'] = [];
                foreach ($catalogEntries as $selectedYear => $catalogEntry) {
                    foreach ($catalogEntry['outline'] as $outlineItem) {
                        $input['curriculum_catalog_outline'][] = $selectedYear . ': ' . $outlineItem;
                    }
                }
                $firstCatalog = reset($catalogEntries);
                $input['curriculum_catalog_status'] = 'selected_years';
                $input['curriculum_catalog_source_url'] = $firstCatalog['source_url'];
            } else {
                $catalogEntry = reset($catalogEntries);
                $input['curriculum_catalog_outline'] = $catalogEntry['outline'];
                $input['curriculum_catalog_status'] = $catalogEntry['status'];
                $input['curriculum_catalog_source_url'] = $catalogEntry['source_url'];
            }
        }
        if ($references === [] && $type !== 'assessment'
            && !($type === 'slides' && !empty($input['selected_week_sections']))) {
            throw new RuntimeException('No reviewed curriculum source matches this request. Ask the Super Admin to review an official resource first. No credits were used.', 422);
        }
        $formatReferences = $search->searchPlanningTemplates($type, $yearGroup);
        $credits = new AiCreditService();
        $reservationId = $credits->reserve(
            (int)$user['id'],
            $type,
            in_array('superadmin', $user['roles'], true)
        );
        try {
            $draft = (new AiProviderService())->generateCurriculumDraft($input, $references, $formatReferences);
            $credits->complete($reservationId);
            json_response(['draft' => $draft, 'credits' => $credits->balance((int)$user['id'])]);
        } catch (Throwable $exception) {
            $credits->refund($reservationId);
            throw $exception;
        }
    }

    if ($path === '/api/ai/assist' && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        if (array_intersect($user['roles'], ['teacher', 'admin', 'superadmin']) === []) {
            throw new RuntimeException('You do not have permission to use the teaching assistant.', 403);
        }
        $input = request_json();
        $messages = $input['messages'] ?? null;
        if (!is_array($messages) || $messages === [] || count($messages) > 8) {
            throw new RuntimeException('Send a question and keep the conversation to the last 8 messages.', 422);
        }
        $lastMessage = end($messages);
        $question = is_array($lastMessage) && is_string($lastMessage['content'] ?? null)
            ? trim($lastMessage['content'])
            : '';
        if ($question === '' || strlen($question) > 3000) {
            throw new RuntimeException('Enter a question of 3000 characters or fewer.', 422);
        }
        $pageContext = trim((string)($input['page_context'] ?? ''));
        $yearGroup = trim((string)($input['year_group'] ?? ''));
        if ($yearGroup !== '' && !in_array($yearGroup, ['SHS1', 'SHS2', 'SHS3'], true)) {
            $yearGroup = '';
        }
        $references = (new CurriculumSearchService())->search($question, $yearGroup !== '' ? $yearGroup : null, 5);
        $credits = new AiCreditService();
        $reservationId = $credits->reserve(
            (int)$user['id'],
            'assistant',
            in_array('superadmin', $user['roles'], true)
        );
        try {
            $reply = (new AiProviderService())->generateAssistantReply($messages, $pageContext, $references);
            $credits->complete($reservationId);
            json_response([
                'reply' => $reply,
                'sources' => array_map(static fn(array $source): array => [
                    'title' => $source['title'],
                    'year_group' => $source['year_group'],
                    'source_reference' => $source['source_reference'] ?? null,
                    'page' => $source['page_start'] === null ? null : (int)$source['page_start'],
                ], $references),
                'credits' => $credits->balance((int)$user['id']),
            ]);
        } catch (Throwable $exception) {
            $credits->refund($reservationId);
            throw $exception;
        }
    }

    if ($path === '/api/admin/ai' && $method === 'GET') {
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        json_response((new AiProviderService())->publicConfig());
    }

    if ($path === '/api/admin/ai' && $method === 'PUT') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        $input = request_json();
        json_response((new AiProviderService())->save($input, (int)$user['id']));
    }

    if ($path === '/api/admin/ai/test' && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        json_response((new AiProviderService())->test());
    }

    if ($path === '/api/admin/brand' && $method === 'PUT') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        json_response((new \Akademi\Services\BrandSettingsService())->save(request_json(), (int)$user['id']));
    }

    if ($path === '/api/admin/oauth-providers' && $method === 'GET') {
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        json_response((new \Akademi\Services\OAuthProviderService())->list());
    }

    if (preg_match('#^/api/admin/oauth-providers/([a-z]+)$#', $path, $matches) && $method === 'PUT') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        $provider = (string)$matches[1];
        json_response((new \Akademi\Services\OAuthProviderService())->save($provider, request_json(), (int)$user['id']));
    }

    if ($path === '/api/admin/curriculum' && $method === 'GET') {
        $user = require_user($auth);
        if (array_intersect($user['roles'], ['admin', 'superadmin']) === []) {
            throw new RuntimeException('You do not have permission to manage curriculum resources.', 403);
        }
        $page = max(1, filter_var($_GET['page'] ?? 1, FILTER_VALIDATE_INT) ?: 1);
        json_response((new CurriculumReviewService())->documents($page, [
            'q' => (string)($_GET['q'] ?? ''),
            'year_groups' => $_GET['year_groups'] ?? ($_GET['year_group'] ?? []),
            'resource_roles' => $_GET['resource_roles'] ?? ($_GET['resource_role'] ?? []),
            'review_status' => (string)($_GET['review_status'] ?? ''),
            'extraction_status' => (string)($_GET['extraction_status'] ?? ''),
        ]));
    }

    if (preg_match('#^/api/admin/curriculum/([1-9][0-9]*)/file$#D', $path, $matches) && $method === 'GET') {
        $user = require_user($auth);
        if (array_intersect($user['roles'], ['admin', 'superadmin']) === []) {
            throw new RuntimeException('You do not have permission to view curriculum resources.', 403);
        }
        $file = (new CurriculumReviewService())->originalPdf((int)$matches[1]);
        header('Content-Type: application/pdf');
        header('Content-Disposition: inline; filename="resource.pdf"; filename*=UTF-8\'\'' . rawurlencode($file['filename']));
        header('Content-Length: ' . (string)$file['bytes']);
        header('Cache-Control: private, no-store, max-age=0');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        readfile($file['path']);
        exit;
    }

    if (preg_match('#^/api/admin/curriculum/([1-9][0-9]*)/source$#D', $path, $matches) && $method === 'GET') {
        $user = require_user($auth);
        if (array_intersect($user['roles'], ['admin', 'superadmin']) === []) {
            throw new RuntimeException('You do not have permission to view curriculum resources.', 403);
        }
        serve_curriculum_resource((new CurriculumReviewService())->originalResource((int)$matches[1]), ($_GET['download'] ?? '') === '1');
    }

    if (preg_match('#^/api/admin/curriculum/([1-9][0-9]*)/reader$#D', $path, $matches) && $method === 'GET') {
        $user = require_user($auth);
        if (array_intersect($user['roles'], ['admin', 'superadmin']) === []) {
            throw new RuntimeException('You do not have permission to view curriculum resources.', 403);
        }
        $offset = filter_var($_GET['offset'] ?? 0, FILTER_VALIDATE_INT);
        if ($offset === false || $offset < 0) {
            throw new RuntimeException('Resource section offset must be a non-negative number.', 422);
        }
        json_response((new CurriculumReviewService())->reader((int)$matches[1], $offset));
    }

    if (preg_match('#^/api/admin/curriculum/([1-9][0-9]*)/preview-ai$#D', $path, $matches) && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        $review = new CurriculumReviewService();
        $credits = new AiCreditService();
        $reservationId = $credits->reserve((int)$user['id'], 'curriculum_preview', true);
        try {
            $result = $review->aiPreview((int)$matches[1]);
            $credits->complete($reservationId);
            json_response([
                'preview' => $result['preview'],
                'pages_used' => $result['pages_used'],
                'notice' => 'AI-generated explanation based on extracted text only; check the original PDF for exact wording and layout.',
            ]);
        } catch (Throwable $exception) {
            $credits->refund($reservationId);
            throw $exception;
        }
    }

    if ($path === '/api/admin/curriculum/process-queued' && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        $input = request_json();
        $documentIds = $input['document_ids'] ?? null;
        if (!is_array($documentIds) || count($documentIds) < 1 || count($documentIds) > 10
            || array_filter($documentIds, static fn(mixed $id): bool => !is_int($id) || $id < 1) !== []) {
            throw new RuntimeException('Choose between 1 and 10 queued resources to process.', 422);
        }
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        ignore_user_abort(true);
        $service = new CurriculumIngestionService();
        $documents = [];
        foreach (array_values(array_unique($documentIds)) as $documentId) {
            set_time_limit(300);
            try {
                $documents[] = $service->processQueuedUpload($documentId);
            } catch (Throwable $exception) {
                write_log('error', 'Queued curriculum extraction request failed', [
                    'document_id' => $documentId,
                    'request_id' => $requestId,
                    'exception' => $exception::class,
                ]);
                $documents[] = [
                    'document_id' => $documentId,
                    'status' => 'failed',
                    'error' => 'Text extraction failed before processing could finish. Retry extraction or inspect the server log.',
                ];
            }
        }
        json_response(['documents' => $documents]);
    }

    if ($path === '/api/admin/curriculum/upload/start' && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        $input = request_json();
        json_response((new \Akademi\Services\CurriculumChunkUploadService())->begin(
            is_array($input['files'] ?? null) ? $input['files'] : [],
            is_array($input['metadata'] ?? null) ? $input['metadata'] : [],
            (int)$user['id']
        ), 201);
    }

    if ($path === '/api/admin/curriculum/upload/chunk' && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        $fileIndex = filter_var($_POST['file_index'] ?? null, FILTER_VALIDATE_INT);
        $chunkIndex = filter_var($_POST['chunk_index'] ?? null, FILTER_VALIDATE_INT);
        if ($fileIndex === false || $chunkIndex === false) {
            throw new RuntimeException('The upload chunk position is invalid.', 422);
        }
        json_response((new \Akademi\Services\CurriculumChunkUploadService())->receive(
            (string)($_POST['upload_id'] ?? ''),
            $fileIndex,
            $chunkIndex,
            is_array($_FILES['chunk'] ?? null) ? $_FILES['chunk'] : [],
            (int)$user['id']
        ));
    }

    if ($path === '/api/admin/curriculum/upload/complete' && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        $input = request_json();
        json_response([
            'result' => (new \Akademi\Services\CurriculumChunkUploadService())->complete(
                (string)($input['upload_id'] ?? ''),
                (int)$user['id']
            ),
        ]);
    }

    if ($path === '/api/admin/curriculum/upload' && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        $contentLength = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($contentLength > 82 * 1024 * 1024) {
            throw new RuntimeException('The combined upload must be 80 MB or smaller.', 413);
        }
        if (!isset($_FILES['files'])) {
            throw new RuntimeException(
                $contentLength > 0
                    ? 'The server rejected the upload size. Check PHP upload_max_filesize and post_max_size.'
                    : 'Select at least one resource file.',
                $contentLength > 0 ? 413 : 422
            );
        }
        json_response([
            'result' => (new CurriculumIngestionService())->upload(
                $_FILES['files'],
                $_POST,
                (int)$user['id']
            ),
        ]);
    }

    if (preg_match('#^/api/admin/curriculum/([1-9][0-9]*)$#', $path, $matches) && $method === 'GET') {
        $user = require_user($auth);
        if (array_intersect($user['roles'], ['admin', 'superadmin']) === []) {
            throw new RuntimeException('You do not have permission to view curriculum resources.', 403);
        }
        json_response((new CurriculumReviewService())->preview((int)$matches[1]));
    }

    if (preg_match('#^/api/admin/curriculum/([1-9][0-9]*)$#D', $path, $matches) && $method === 'DELETE') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        if (array_intersect($user['roles'], ['admin', 'superadmin']) === []) {
            throw new RuntimeException('You do not have permission to delete curriculum resources.', 403);
        }
        json_response(['result' => (new CurriculumReviewService())->deleteDocument(
            (int)$matches[1],
            (int)$user['id']
        )]);
    }

    if (preg_match('#^/api/admin/curriculum/([1-9][0-9]*)/metadata$#', $path, $matches) && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        json_response(['document' => (new CurriculumReviewService())->updateMetadata(
            (int)$matches[1],
            (int)$user['id'],
            request_json()
        )]);
    }

    if (preg_match('#^/api/admin/curriculum/([1-9][0-9]*)/enabled$#', $path, $matches) && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        $input = request_json();
        if (!is_bool($input['enabled'] ?? null)) {
            throw new RuntimeException('Choose whether this resource should be enabled or disabled.', 422);
        }
        json_response(['result' => (new CurriculumReviewService())->setEnabled(
            (int)$matches[1],
            $input['enabled'],
            (int)$user['id']
        )]);
    }

    if (preg_match('#^/api/admin/curriculum/([1-9][0-9]*)/review$#', $path, $matches) && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        $input = request_json();
        $result = (new CurriculumReviewService())->setReviewStatus(
            (int)$matches[1],
            (string)($input['status'] ?? ''),
            (int)$user['id'],
            $input
        );
        json_response(['document' => $result]);
    }

    if (preg_match('#^/api/admin/curriculum/([1-9][0-9]*)/sections/([1-9][0-9]*)/review$#', $path, $matches) && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        json_response(['document' => (new CurriculumReviewService())->reviewSection(
            (int)$matches[1],
            (int)$matches[2],
            (int)$user['id'],
            request_json()
        )]);
    }

    if (preg_match('#^/api/admin/curriculum/([1-9][0-9]*)/weekly-lessons/([1-9][0-9]*)/review$#D', $path, $matches) && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        json_response(['document' => (new CurriculumReviewService())->reviewWeeklyLesson(
            (int)$matches[1],
            (int)$matches[2],
            (int)$user['id'],
            request_json()
        )]);
    }

    if (preg_match('#^/api/admin/curriculum/([1-9][0-9]*)/structure$#', $path, $matches) && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        $auth->requireRole($user, 'superadmin');
        $input = request_json();
        $offset = filter_var($input['offset'] ?? 0, FILTER_VALIDATE_INT);
        if ($offset === false || $offset < 0) {
            throw new RuntimeException('Batch offset must be a non-negative number.', 422);
        }
        json_response((new CurriculumStructureService())->extractBatch((int)$matches[1], $offset, (int)$user['id']));
    }

    if ($path === '/admin/ai' && $method === 'GET') {
        $user = $auth->currentUser();
        if (!$user) {
            header('Location: ' . app_url('login'), true, 303);
            exit;
        }
        $auth->requireRole($user, 'superadmin');
        $adminUser = $user;
        require AKADEMI_ROOT . DIRECTORY_SEPARATOR . 'app' . DIRECTORY_SEPARATOR . 'Views' . DIRECTORY_SEPARATOR . 'admin-ai.php';
        exit;
    }

    if ($path === '/api/admin/users' && $method === 'GET') {
        $user = require_user($auth);
        if (array_intersect($user['roles'], ['admin', 'superadmin']) === []) {
            throw new RuntimeException('You do not have permission to manage users.', 403);
        }
        $page = max(1, filter_var($_GET['page'] ?? 1, FILTER_VALIDATE_INT) ?: 1);
        $result = (new \Akademi\Services\UserManagementService())->list(
            $user,
            (string)($_GET['q'] ?? ''),
            (string)($_GET['status'] ?? ''),
            $page
        );
        json_response($result);
    }

    if (preg_match('#^/api/admin/users/([1-9][0-9]*)$#D', $path, $matches) && $method === 'PUT') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        if (array_intersect($user['roles'], ['admin', 'superadmin']) === []) {
            throw new RuntimeException('You do not have permission to manage users.', 403);
        }
        json_response((new \Akademi\Services\UserManagementService())->update(
            (int)$matches[1],
            request_json(),
            $user
        ));
    }

    if (preg_match('#^/api/admin/users/([1-9][0-9]*)/password$#D', $path, $matches) && $method === 'POST') {
        Csrf::verifyRequest();
        $user = require_user($auth);
        if (array_intersect($user['roles'], ['admin', 'superadmin']) === []) {
            throw new RuntimeException('You do not have permission to reset user passwords.', 403);
        }
        json_response((new \Akademi\Services\UserManagementService())->resetPassword(
            (int)$matches[1],
            $user
        ));
    }

    if ($path === '/admin/users' && $method === 'GET') {
        $user = $auth->currentUser();
        if (!$user) {
            header('Location: ' . app_url('login'), true, 303);
            exit;
        }
        if (array_intersect($user['roles'], ['admin', 'superadmin']) === []) {
            throw new RuntimeException('You do not have permission to manage users.', 403);
        }
        $adminUser = $user;
        require AKADEMI_ROOT . DIRECTORY_SEPARATOR . 'app' . DIRECTORY_SEPARATOR . 'Views' . DIRECTORY_SEPARATOR . 'admin-users.php';
        exit;
    }

    if ($path === '/admin/curriculum' && $method === 'GET') {
        $user = $auth->currentUser();
        if (!$user) {
            header('Location: ' . app_url('login'), true, 303);
            exit;
        }
        if (array_intersect($user['roles'], ['admin', 'superadmin']) === []) {
            throw new RuntimeException('You do not have permission to manage curriculum resources.', 403);
        }
        $adminUser = $user;
        require AKADEMI_ROOT . DIRECTORY_SEPARATOR . 'app' . DIRECTORY_SEPARATOR . 'Views' . DIRECTORY_SEPARATOR . 'admin-curriculum.php';
        exit;
    }

    if (($path === '/' || $path === '/index.html') && $method === 'GET') {
        $user = $auth->currentUser();
        if (!$user) {
            header('Location: ' . app_url('login'), true, 303);
            exit;
        }
        $workspace = file_get_contents(AKADEMI_ROOT . DIRECTORY_SEPARATOR . 'index.html');
        if ($workspace === false) {
            throw new RuntimeException('Teacher workspace could not be loaded.');
        }
        $adminNavClass = in_array('superadmin', $user['roles'], true) ? 'admin-only' : 'admin-only hidden';
        header_remove('Cache-Control');
        header('Cache-Control: no-store, private');
        echo str_replace(
            ['{{APP_BASE_PATH}}', '{{CSRF_TOKEN}}', '{{ADMIN_NAV_CLASS}}'],
            [e(app_base_path()), e(Csrf::token()), e($adminNavClass)],
            $workspace
        );
        exit;
    }

    if (str_starts_with($path, '/api/')) {
        json_response(['error' => 'API endpoint not found.'], 404);
    }
    http_response_code(404);
    header('Content-Type: text/html; charset=utf-8');
    $errorType = 'not-found';
    $statusCode = 404;
    $requestReference = $requestId;
    require AKADEMI_ROOT . DIRECTORY_SEPARATOR . 'app' . DIRECTORY_SEPARATOR . 'Views' . DIRECTORY_SEPARATOR . 'error.php';
} catch (Throwable $exception) {
    $status = (int)$exception->getCode();
    if ($status < 400 || $status > 599) {
        $status = 500;
    }
    $logContext = [
        'request_id' => $requestId,
        'status' => $status,
        'exception' => $exception::class,
        'route' => $path,
    ];
    if ($exception instanceof \PDOException) {
        $databaseError = $exception->errorInfo ?? [];
        $logContext['db_sqlstate'] = (string)($databaseError[0] ?? $exception->getCode());
        $logContext['db_driver'] = (int)($databaseError[1] ?? 0);
        $logContext['db_host'] = (string)(env('DB_HOST', '127.0.0.1') ?? '127.0.0.1');
        $logContext['db_database'] = (string)(env('DB_DATABASE', 'akademi') ?? 'akademi');
        $logContext['db_username_set'] = (string)(env('DB_USERNAME', '') ?? '') !== '';
        if (preg_match('/using password:\s*(NO|YES)/i', $exception->getMessage(), $authMatch)) {
            $logContext['db_auth_mode'] = strtoupper($authMatch[1]) === 'NO' ? 'password-not-supplied' : 'password-supplied';
        }
    }
    write_log($status >= 500 ? 'error' : 'notice', 'Request failed', $logContext);
    if (str_starts_with($path, '/api/')) {
         // Always display the exact exception message returned from the server
        $message = $exception->getMessage();
        json_response(['error' => $message, 'request_id' => $requestId], $status);
        
        /*$publicStatuses = [400, 401, 403, 404, 405, 409, 413, 419, 422, 429, 503];
        if (in_array($status, $publicStatuses, true)) {
            $message = $exception->getMessage();
        } elseif ($exception instanceof \PDOException) {
            $databaseError = $exception->errorInfo ?? [];
            $driverCode = (int)($databaseError[1] ?? 0);
            if ($driverCode === 1045 && preg_match('/using password:\s*NO/i', $exception->getMessage())) {
                $message = 'MySQL rejected the application login (error 1045) and reports that Apache supplied no password. Check DB_PASSWORD in this project’s .env if the MySQL account requires one. If local MySQL is intentionally passwordless, compare Apache’s DB_HOST with the MySQL instance your CLI uses and check that account’s host permissions. The project .env is loaded on each request; restarting Apache alone will not fix an incorrect account or host grant.';
            } else {
                $message = match ($driverCode) {
                    1045 => 'MySQL rejected the configured database account (error 1045). Check DB_HOST, DB_USERNAME, DB_PASSWORD and the MySQL account’s host permissions in this project’s .env. The project .env is loaded on each request.',
                    1049 => 'The configured database does not exist. Check DB_DATABASE in .env and create the database before running migrations.',
                    1146 => 'A required database table is missing. Run C:\\xampp\\php\\php.exe bin\\migrate.php from the application folder.',
                    default => 'The database request failed. Check that MySQL is running and that all database migrations have been applied.',
                };
            }
        } else {
            $message = 'The server could not complete this request. Check APP_KEY, database migrations, and write access to private application storage. Use the reference ID to find the server log entry.';
        }
        json_response(['error' => $message, 'request_id' => $requestId], $status);*/
    }
    if ($status === 403) {
        http_response_code(403);
        header('Content-Type: text/html; charset=utf-8');
        $errorType = 'forbidden';
    } elseif ($exception instanceof \PDOException) {
        $errorType = 'database';
    } elseif ($status === 503) {
        $errorType = 'unavailable';
    } elseif ($status === 404) {
        $errorType = 'not-found';
    } elseif ($status >= 400 && $status < 500) {
        $errorType = 'request';
    } else {
        $errorType = 'server';
    }
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    $statusCode = $status;
    $requestReference = $requestId;
    require AKADEMI_ROOT . DIRECTORY_SEPARATOR . 'app' . DIRECTORY_SEPARATOR . 'Views' . DIRECTORY_SEPARATOR . 'error.php';
}
