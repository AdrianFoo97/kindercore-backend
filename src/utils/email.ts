import nodemailer from 'nodemailer';

const transporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 465,
      secure: (Number(process.env.SMTP_PORT) || 465) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

export async function sendInviteEmail(to: string, inviteLink: string, role: string): Promise<boolean> {
  if (!transporter) {
    console.warn('[Email] SMTP not configured — skipping invite email to', to);
    return false;
  }

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06),0 8px 24px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background-color:#1d4ed8;padding:32px 40px;text-align:center;">
      <div style="display:inline-flex;align-items:center;gap:8px;">
        <div style="width:28px;height:28px;background:rgba(255,255,255,0.2);border-radius:7px;display:inline-flex;align-items:center;justify-content:center;">
          <span style="color:white;font-size:16px;font-weight:800;">K</span>
        </div>
        <span style="color:white;font-size:18px;font-weight:700;letter-spacing:-0.3px;">KinderTech</span>
      </div>
    </div>

    <!-- Body -->
    <div style="padding:36px 40px 40px;">
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">You're invited</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#64748b;line-height:1.6;">
        You've been invited to join the KinderTech admin portal as <strong style="color:#374151;">${role === 'ADMIN' ? 'an Admin' : 'a Staff member'}</strong>.
        Click the button below to set up your account.
      </p>

      <!-- CTA Button — using table for max email client compatibility -->
      <div style="text-align:center;margin:28px 0;">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${inviteLink}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="21%" fillcolor="#1d4ed8">
          <w:anchorlock/><center style="color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:bold;">Set up your account</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-->
        <a href="${inviteLink}" target="_blank" style="display:inline-block;padding:14px 40px;background-color:#1d4ed8;color:#ffffff !important;text-decoration:none;border-radius:10px;font-size:15px;font-weight:700;letter-spacing:0.01em;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;mso-hide:all;">
          Set up your account
        </a>
        <!--<![endif]-->
      </div>

      <!-- Link fallback -->
      <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        <a href="${inviteLink}" style="color:#1d4ed8;word-break:break-all;">${inviteLink}</a>
      </p>

      <div style="border-top:1px solid #f1f5f9;margin-top:28px;padding-top:20px;">
        <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;">
          This invite link expires in 7 days. If you didn't expect this invitation, you can safely ignore this email.
        </p>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <div style="text-align:center;padding:16px 0 32px;">
    <p style="margin:0;font-size:11px;color:#94a3b8;">
      KinderTech · Internal staff portal
    </p>
  </div>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: `"KinderTech" <${process.env.SMTP_USER}>`,
      to,
      subject: 'You\'re invited to KinderTech',
      html,
    });
    console.log('[Email] Invite sent to', to);
    return true;
  } catch (err) {
    console.error('[Email] Failed to send invite to', to, err);
    return false;
  }
}
