/**
 * PH Hoops Email Service
 * Uses Gmail via Nodemailer
 *
 * Setup Gmail:
 * 1. Go to Google Account → Security → 2-Step Verification (enable it)
 * 2. Go to Security → App Passwords → Generate one for "Mail"
 * 3. Add to Railway Variables:
 *    GMAIL_USER = your.email@gmail.com
 *    GMAIL_PASS = your-16-char-app-password
 *    APP_URL    = https://yourapp.railway.app
 */

const nodemailer = require('nodemailer');

function getTransporter() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
    console.warn('⚠️  Email not configured — GMAIL_USER or GMAIL_PASS missing');
    return null;
  }
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });
}

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const FROM    = process.env.GMAIL_USER || 'noreply@phhoops.com';

// ── SEND VERIFICATION EMAIL ───────────────────────────────────────────────────
async function sendVerificationEmail(user, token) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[DEV] Verification link: ${APP_URL}/verify-email?token=${token}`);
    return;
  }

  const link = `${APP_URL}/verify-email?token=${token}`;

  await transporter.sendMail({
    from: `"PH Hoops League Manager" <${FROM}>`,
    to: user.email,
    subject: '✅ Verify your PH Hoops account',
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family:Arial,sans-serif;background:#0a0e1a;color:#f0f4ff;padding:32px;margin:0">
        <div style="max-width:480px;margin:0 auto;background:#0f1628;border-radius:12px;border-top:3px solid #e63329;padding:32px">
          <div style="font-size:22px;font-weight:900;color:#f0f4ff;letter-spacing:2px;margin-bottom:4px">🏀 PH HOOPS</div>
          <div style="font-size:10px;color:#e63329;letter-spacing:3px;font-weight:700;margin-bottom:24px">LEAGUE MANAGER</div>
          <h2 style="color:#f5c842;font-size:20px;margin-bottom:8px">Welcome, ${user.name}!</h2>
          <p style="color:rgba(240,244,255,.7);font-size:14px;line-height:1.7;margin-bottom:24px">
            Thanks for registering as a commissioner. Please verify your email address to activate your account.
          </p>
          <a href="${link}"
             style="display:inline-block;background:#e63329;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;margin-bottom:24px">
            ✅ Verify My Email →
          </a>
          <p style="color:rgba(240,244,255,.4);font-size:12px;margin-top:20px;border-top:1px solid rgba(240,244,255,.08);padding-top:16px">
            This link expires in <strong style="color:#f0f4ff">24 hours</strong>.<br>
            If you didn't register, you can safely ignore this email.
          </p>
        </div>
      </body>
      </html>
    `,
  });

  console.log(`✅ Verification email sent to ${user.email}`);
}

// ── SEND PASSWORD RESET EMAIL ─────────────────────────────────────────────────
async function sendPasswordResetEmail(user, token) {
  const transporter = getTransporter();
  const link = `${APP_URL}/reset-password?token=${token}`;

  if (!transporter) {
    console.log(`[DEV] Password reset link: ${link}`);
    return;
  }

  await transporter.sendMail({
    from: `"PH Hoops League Manager" <${FROM}>`,
    to: user.email,
    subject: '🔑 Reset your PH Hoops password',
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family:Arial,sans-serif;background:#0a0e1a;color:#f0f4ff;padding:32px;margin:0">
        <div style="max-width:480px;margin:0 auto;background:#0f1628;border-radius:12px;border-top:3px solid #e63329;padding:32px">
          <div style="font-size:22px;font-weight:900;color:#f0f4ff;letter-spacing:2px;margin-bottom:4px">🏀 PH HOOPS</div>
          <div style="font-size:10px;color:#e63329;letter-spacing:3px;font-weight:700;margin-bottom:24px">LEAGUE MANAGER</div>
          <h2 style="color:#f5c842;font-size:20px;margin-bottom:8px">Password Reset</h2>
          <p style="color:rgba(240,244,255,.7);font-size:14px;line-height:1.7;margin-bottom:24px">
            Hi ${user.name}, click the button below to reset your password.
          </p>
          <a href="${link}"
             style="display:inline-block;background:#e63329;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;margin-bottom:24px">
            🔑 Reset Password →
          </a>
          <p style="color:rgba(240,244,255,.4);font-size:12px;margin-top:20px;border-top:1px solid rgba(240,244,255,.08);padding-top:16px">
            This link expires in <strong style="color:#f0f4ff">1 hour</strong>.<br>
            If you didn't request a reset, ignore this email.
          </p>
        </div>
      </body>
      </html>
    `,
  });

  console.log(`✅ Password reset email sent to ${user.email}`);
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
