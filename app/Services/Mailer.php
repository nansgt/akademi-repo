<?php
declare(strict_types=1);

namespace Akademi\Services;

use PHPMailer\PHPMailer\Exception as MailException;
use PHPMailer\PHPMailer\PHPMailer;
use RuntimeException;

final class Mailer
{
    public static function sendVerificationCode(string $email, string $code, int $expiryMinutes, string $purpose = 'login'): void
    {
        $mail = self::configuredMailer();
        $isRegistration = $purpose === 'register';
        $subject = $isRegistration ? 'Verify your Akademi account' : 'Your Akademi sign-in code';
        $heading = $isRegistration ? 'Verify your Akademi account' : 'Your sign-in code';
        $instruction = $isRegistration
            ? 'Enter this one-time code on the Akademi verification page to finish creating your teacher account.'
            : 'Enter this one-time code on the Akademi sign-in page to continue to your teacher workspace.';
        try {
            $mail->addAddress($email);
            $mail->Subject = $subject;
            $mail->addCustomHeader('Auto-Submitted', 'auto-generated');
            $mail->addCustomHeader('X-Auto-Response-Suppress', 'All');
            $mail->isHTML(true);
            $mail->Body = self::emailLayout(
                $heading,
                '<p style="margin:0 0 22px;color:#435249;font-size:16px;line-height:1.6">' . htmlspecialchars($instruction, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '</p>'
                . '<div style="margin:0 0 22px;padding:18px;border:1px solid #e2ebe3;border-radius:10px;background:#f5f8f5;text-align:center">'
                . '<span style="display:block;margin-bottom:7px;color:#6f7f74;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase">Your one-time code</span>'
                . '<strong style="color:#143c32;font-family:Consolas,monospace;font-size:34px;letter-spacing:8px">' . htmlspecialchars($code, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '</strong>'
                . '</div>'
                . '<p style="margin:0 0 12px;color:#536258;font-size:13px;line-height:1.7">This code expires in <strong>' . $expiryMinutes . ' minutes</strong> and can only be used once.</p>'
                . '<p style="margin:0;color:#78847d;font-size:13px;line-height:1.7">If you did not request this sign-in code, you can safely ignore this email. Never share the code with anyone.</p>'
            );
            $mail->AltBody = "{$heading}: {$code}\n\n{$instruction}\n\n"
                . "It expires in {$expiryMinutes} minutes and can only be used once. Never share this code. "
                . "If you did not request it, you can ignore this email.\n";
            $mail->send();
            $smtp = $mail->getSMTPInstance();
            write_log('info', 'SMTP accepted verification email', [
                'recipient_sha256' => hash('sha256', strtolower(trim($email))),
                'mail_message_id' => $mail->getLastMessageID(),
                'smtp_transaction_id' => $smtp->getLastTransactionID(),
                'smtp_reply' => self::safeMailDetail($mail, $smtp->getLastReply()),
                'purpose' => $isRegistration ? 'register' : 'login',
                'delivery_status' => 'accepted_by_smtp',
            ]);
        } catch (MailException $exception) {
            write_log('error', 'Verification email delivery failed', [
                'exception' => $exception::class,
                'recipient_sha256' => hash('sha256', strtolower(trim($email))),
                'detail' => self::safeMailError($mail, $exception),
            ]);
            throw new RuntimeException('The mail server could not deliver the verification email. Check SMTP settings and try again.', 503);
        }
    }

    public static function sendScoreSheet(string $email, string $assessmentTitle, string $className, string $csv, string $fileName): void
    {
        $mail = self::configuredMailer();
        try {
            $mail->addAddress($email);
            $mail->Subject = 'Assessment score sheet: ' . mb_substr($assessmentTitle, 0, 150);
            $mail->addCustomHeader('Auto-Submitted', 'auto-generated');
            $mail->addCustomHeader('X-Auto-Response-Suppress', 'All');
            $mail->isHTML(true);
            $safeClass = htmlspecialchars($className, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
            $safeTitle = htmlspecialchars($assessmentTitle, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
            $mail->Body = self::emailLayout(
                'Assessment score sheet',
                '<p style="margin:0 0 14px;color:#435249;font-size:15px;line-height:1.6">The latest score sheet for <strong>' . $safeTitle . '</strong> is attached.</p>'
                . '<p style="margin:0;color:#536258;font-size:13px;line-height:1.7">Class: <strong>' . $safeClass . '</strong>. Review pending written responses in your Akademi assessment results.</p>'
            );
            $mail->AltBody = "The latest score sheet for {$assessmentTitle} is attached. Class: {$className}. Review pending written responses in your Akademi assessment results.\n";
            $mail->addStringAttachment($csv, $fileName, PHPMailer::ENCODING_BASE64, 'text/csv');
            $mail->send();
            write_log('info', 'Assessment score sheet email accepted by SMTP', [
                'recipient_sha256' => hash('sha256', strtolower(trim($email))),
                'mail_message_id' => $mail->getLastMessageID(),
                'delivery_status' => 'accepted_by_smtp',
            ]);
        } catch (MailException $exception) {
            write_log('error', 'Assessment score sheet email failed', [
                'exception' => $exception::class,
                'recipient_sha256' => hash('sha256', strtolower(trim($email))),
                'detail' => self::safeMailError($mail, $exception),
            ]);
            throw new RuntimeException('The score sheet could not be emailed. Check SMTP settings and try again.', 503);
        }
    }

    public static function sendTestMessage(string $email): void
    {
        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw new RuntimeException('Enter a valid test-recipient email address.', 422);
        }
        $mail = self::configuredMailer();
        try {
            $mail->addAddress($email);
            $mail->Subject = 'Akademi email delivery test';
            $mail->isHTML(true);
            $mail->Body = self::emailLayout(
                'Email delivery is connected',
                '<p style="margin:0 0 16px;color:#435249;font-size:15px;line-height:1.7">Your Akademi email service has successfully submitted this test message.</p>'
                . '<div style="margin:0;padding:14px 16px;border-left:3px solid #4a805e;background:#f4f8f4;color:#56645b;font-size:13px;line-height:1.7">'
                . 'Sign-in verification codes and important account messages can now be delivered using this mailbox.'
                . '</div>'
            );
            $mail->AltBody = "Your Akademi email service has successfully submitted this test message.\n\n"
                . "Sign-in verification codes and important account messages can now be delivered using this mailbox.\n";
            $mail->send();
            $smtp = $mail->getSMTPInstance();
            write_log('info', 'SMTP accepted test email', [
                'recipient_sha256' => hash('sha256', strtolower(trim($email))),
                'mail_message_id' => $mail->getLastMessageID(),
                'smtp_transaction_id' => $smtp->getLastTransactionID(),
                'smtp_reply' => self::safeMailDetail($mail, $smtp->getLastReply()),
                'delivery_status' => 'accepted_by_smtp',
            ]);
        } catch (MailException $exception) {
            write_log('error', 'SMTP test email delivery failed', [
                'exception' => $exception::class,
                'recipient_sha256' => hash('sha256', strtolower(trim($email))),
                'detail' => self::safeMailError($mail, $exception),
            ]);
            throw new RuntimeException('The SMTP test message could not be sent. Check the mail settings and try again.', 503);
        }
    }

    private static function safeMailError(PHPMailer $mail, MailException $exception): string
    {
        $detail = trim($mail->ErrorInfo !== '' ? $mail->ErrorInfo : $exception->getMessage());
        return self::safeMailDetail($mail, $detail);
    }

    private static function safeMailDetail(PHPMailer $mail, ?string $detail): string
    {
        $detail = (string)$detail;
        $secrets = array_filter([$mail->Password, $mail->Username], static fn(string $secret): bool => $secret !== '');
        $detail = str_replace($secrets, '[redacted]', $detail);
        $detail = preg_replace('/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/', '[redacted-email]', $detail) ?? $detail;
        return mb_substr(preg_replace('/[\r\n\t]+/', ' ', $detail) ?? '', 0, 500);
    }

    private static function emailLayout(string $heading, string $content): string
    {
        $safeHeading = htmlspecialchars($heading, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            . '<title>' . $safeHeading . '</title></head>'
            . '<body style="margin:0;padding:0;background:#f2f5f1;font-family:Arial,Helvetica,sans-serif;color:#26362d">'
            . '<div style="display:none;max-height:0;overflow:hidden;opacity:0">Akademi account notification</div>'
            . '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f2f5f1">'
            . '<tr><td align="center" style="padding:34px 14px">'
            . '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px">'
            . '<tr><td style="padding:0 0 17px">'
            . '<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>'
            . '<td width="42" height="42" align="center" valign="middle" style="border-radius:12px 12px 12px 4px;background:#143c32;color:#fff;font-size:23px;font-weight:bold">A</td>'
            . '<td style="padding-left:11px"><span style="display:block;color:#143c32;font-size:21px;font-weight:bold;letter-spacing:-.5px">akademi</span>'
            . '<span style="display:block;margin-top:3px;color:#78877d;font-size:9px;font-weight:bold;letter-spacing:1.4px">GHANA · TEACHER WORKSPACE</span></td>'
            . '</tr></table></td></tr>'
            . '<tr><td style="padding:0;border:1px solid #e2e9e2;border-radius:12px;background:#fff">'
            . '<div style="height:5px;border-radius:12px 12px 0 0;background:#143c32"></div>'
            . '<div style="padding:32px 34px 30px"><h1 style="margin:0 0 22px;color:#20332a;font-size:24px;line-height:1.3">' . $safeHeading . '</h1>'
            . $content . '</div></td></tr>'
            . '<tr><td style="padding:20px 12px 0;color:#7c8980;font-size:11px;line-height:1.7;text-align:center">'
            . '<strong style="color:#58675d">Akademi · Ghana SHS Teacher Workspace</strong><br>'
            . 'This is an automated account message. Please do not reply to this email.<br>'
            . 'If you did not initiate this request, no action is needed.'
            . '</td></tr></table></td></tr></table></body></html>';
    }

    private static function configuredMailer(): PHPMailer
    {
        if (!class_exists(PHPMailer::class)) {
            throw new RuntimeException('Email package is missing. Run composer install before enabling authentication.', 503);
        }
        $config = (new MailSettingsService())->secretConfig();
        $from = $config['from_address'];
        if (filter_var($from, FILTER_VALIDATE_EMAIL) === false || $config['host'] === '') {
            throw new RuntimeException('Email delivery is not configured. Configure SMTP in Super Admin settings.', 503);
        }
        $encryption = strtolower($config['encryption']);
        if (!in_array($encryption, ['tls', 'ssl', 'none'], true)) {
            throw new RuntimeException('SMTP encryption must be TLS, SSL or none.', 503);
        }
        if ($config['username'] !== '' && $config['password'] === '') {
            throw new RuntimeException('SMTP authentication is configured without a password.', 503);
        }
        $mail = new PHPMailer(true);
        $mail->isSMTP();
        $mail->Host = $config['host'];
        $mail->Port = $config['port'];
        $mail->SMTPAuth = $config['username'] !== '';
        $mail->Username = $config['username'];
        $mail->Password = $config['password'];
        $mail->Timeout = 12;
        $mail->SMTPAutoTLS = $encryption === 'tls';
        if ($encryption === 'tls') {
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        } elseif ($encryption === 'ssl') {
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
        }
        $mail->CharSet = PHPMailer::CHARSET_UTF8;
        $mail->setFrom($from, $config['from_name']);
        $mail->Sender = $from;
        return $mail;
    }
}
