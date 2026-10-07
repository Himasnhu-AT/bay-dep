import { thrownText } from '@shared/telemetry'
import { bay } from './bridge'

/**
 * Forwards the renderer's own uncaught errors to main, which redacts them and sends a crash report
 * if Preferences › Privacy › Crash reports is on. Only the message and stack cross — and for a
 * rejection with something other than an Error, only its type (`thrownText`) — the renderer
 * never reaches the network, and main decides what of the text may leave the machine.
 *
 * Nothing is prevented: the console still shows every error exactly as before.
 */

/** Chromium's notice that a ResizeObserver callback was deferred: a warning, not a fault. */
const BENIGN = /^ResizeObserver loop/

export function installErrorReports(target: Window = window): void {
  target.addEventListener('error', (event) => {
    // A failed <img> or <video> load is an `error` event too, but not an ErrorEvent — not a crash.
    if (!(event instanceof ErrorEvent)) return
    const { message, stack } = event.error !== undefined && event.error !== null ? thrownText(event.error, 'thrown') : { message: event.message, stack: undefined }
    if (!message || BENIGN.test(message)) return
    bay()?.telemetry.reportError({ kind: 'error', message, ...(stack ? { stack } : {}) })
  })
  target.addEventListener('unhandledrejection', (event) => {
    const { message, stack } = thrownText(event.reason, 'rejection')
    bay()?.telemetry.reportError({ kind: 'rejection', message, ...(stack ? { stack } : {}) })
  })
}
