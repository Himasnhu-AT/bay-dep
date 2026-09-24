/**
 * What a build is allowed to do about access, decided from `app.isPackaged` and the environment.
 *
 * Pure and Electron-free: the caller passes `app.isPackaged` in. The one property that matters is
 * that **nothing here loosens a packaged build** — no env var skips the check, points the handoff
 * at another site, or silences the browser once bay is an installed app. `build.test.ts` holds each
 * function over both values of `isPackaged`.
 */

import { DEV_SITE_ORIGIN, SITE_ORIGIN } from '@shared/access'

type Env = Record<string, string | undefined>

/**
 * `BAY_ACCESS=dev` skips the access check entirely — so `./run.sh` and every `test/app` probe work
 * without an account. Honoured ONLY by an unpackaged build (`electron .` from a checkout).
 */
export function accessBypass(env: Env, isPackaged: boolean): boolean {
  return !isPackaged && env['BAY_ACCESS'] === 'dev'
}

/** The origins whose POST the loopback handoff accepts. */
export function allowedOrigins(isPackaged: boolean): string[] {
  return isPackaged ? [SITE_ORIGIN] : [SITE_ORIGIN, DEV_SITE_ORIGIN]
}

/** The site the browser is sent to: the dev server only for an unpackaged build asked for it. */
export function siteOrigin(env: Env, isPackaged: boolean): string {
  return !isPackaged && env['BAY_SITE'] === 'local' ? DEV_SITE_ORIGIN : SITE_ORIGIN
}

/**
 * A test hook: record the sign-in URL instead of opening a browser, so a probe can check the URL
 * without a real browser window appearing. Unpackaged only.
 */
export function browserSuppressed(env: Env, isPackaged: boolean): boolean {
  return !isPackaged && env['BAY_ACCESS_NO_BROWSER'] === '1'
}
