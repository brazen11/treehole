const nodemailer = require('nodemailer');

async function sendEmailViaSMTP(to, subject, html) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    connectionTimeout: 15000,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  await transporter.sendMail({
    from: `"树洞" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  });
}

async function sendEmailViaBrevo(to, subject, html) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: process.env.BREVO_FROM || 'ljyjohn990@gmail.com', name: '树洞' },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo API error: ${res.status} ${body}`);
  }
}

async function sendEmailViaSendGrid(to, subject, html) {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: process.env.SENDGRID_FROM || 'ljyjohn990@gmail.com', name: '树洞' },
      subject,
      content: [{ type: 'text/html', value: html }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SendGrid API error: ${res.status} ${body}`);
  }
}

async function sendEmail(to, subject, html) {
  if (process.env.BREVO_API_KEY) {
    await sendEmailViaBrevo(to, subject, html);
  } else if (process.env.SENDGRID_API_KEY) {
    await sendEmailViaSendGrid(to, subject, html);
  } else {
    await sendEmailViaSMTP(to, subject, html);
  }
}

module.exports = { sendEmail };
