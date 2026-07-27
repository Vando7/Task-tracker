import { buildApp } from './app'
import { closeDatabase, initDatabase } from './db'
import { env, pushEnabled } from './env'
import { startScheduler } from './jobs/scheduler'

async function main(): Promise<void> {
  await initDatabase()

  const app = await buildApp()
  const stopScheduler = startScheduler()

  await app.listen({ port: env.PORT, host: env.HOST })

  console.log(
    [
      '',
      `  Task Tracker API  ·  http://${env.HOST}:${env.PORT}`,
      `  env: ${env.NODE_ENV}   push: ${pushEnabled ? 'configured' : 'off (in-app only)'}`,
      `  mail: ${env.MAIL_TRANSPORT}${env.MAIL_TRANSPORT === 'console' ? ' — verification links print here' : ''}`,
      '',
    ].join('\n'),
  )

  // Finish in-flight requests, stop the tick, close the database. Without this
  // a `pnpm dev` restart can leave the SQLite file locked.
  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`\n  ${signal} — shutting down`)
    stopScheduler()
    await app.close()
    await closeDatabase()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
