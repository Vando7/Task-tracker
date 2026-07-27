import { env, isProduction } from '../env'

/**
 * The single seam through which all outbound email passes.
 *
 * In development, links are printed to the server console — there is no SMTP
 * server and no Mailpit container to run (section 4.2). Production points this
 * at one transactional provider, and because every caller goes through
 * `sendMail`, that is a one-function change.
 */

export type MailMessage = {
  to: string
  subject: string
  text: string
}

export async function sendMail(message: MailMessage): Promise<void> {
  if (env.MAIL_TRANSPORT === 'console') {
    if (isProduction) {
      // Refuse to silently drop real mail in production.
      throw new Error('MAIL_TRANSPORT=console is not usable in production')
    }
    console.log(
      [
        '',
        '  ┌─ email ────────────────────────────────────────────────',
        `  │ to:      ${message.to}`,
        `  │ subject: ${message.subject}`,
        '  ├────────────────────────────────────────────────────────',
        ...message.text.split('\n').map((line) => `  │ ${line}`),
        '  └────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    )
    return
  }

  throw new Error(
    'MAIL_TRANSPORT=smtp is declared but no provider is wired up yet. ' +
      'Implement it here — this is the only place that needs to change.',
  )
}

export function verificationEmail(to: string, token: string): MailMessage {
  const url = `${env.APP_ORIGIN}/verify?token=${encodeURIComponent(token)}`
  return {
    to,
    subject: 'Confirm your Task Tracker address',
    text: `Welcome to Task Tracker.\n\nConfirm your address to finish signing up:\n\n${url}\n\nThe link is good for 24 hours.`,
  }
}

export function passwordResetEmail(to: string, token: string): MailMessage {
  const url = `${env.APP_ORIGIN}/reset?token=${encodeURIComponent(token)}`
  return {
    to,
    subject: 'Reset your Task Tracker password',
    text: `Someone asked to reset the password for this address.\n\n${url}\n\nThe link is good for one hour and can be used once. If it wasn't you, ignore this email.`,
  }
}
