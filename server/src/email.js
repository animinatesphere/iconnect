function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

export function createOtpSender({ apiKey, from, production, logger = console }) {
  return async function sendOtpEmail({ email, name, code }) {
    if (!apiKey && !production) {
      logger.info(`Development email OTP for ${email}: ${code}`)
      return
    }
    if (!apiKey || !from) throw new Error('Email delivery is not configured.')

    const safeName = escapeHtml(name)
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Your iConnect verification code',
        text: `Hi ${name}, your iConnect verification code is ${code}. It expires in 10 minutes.`,
        html: `<p>Hi ${safeName},</p><p>Your iConnect verification code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>`,
      }),
    })

    if (!response.ok) {
      throw new Error(`Resend rejected the verification email (HTTP ${response.status}).`)
    }
  }
}
