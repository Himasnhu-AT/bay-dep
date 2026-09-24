/**
 * bay's access state in the running app: load it, verify it, sign in, refer — and tell everyone.
 *
 * The decisions live in the Electron-free modules beside this one (`policy`, `handoff`, `google`,
 * `token-store`, `gate`, `build`), each unit-tested. This file is the wiring: timers, the disk,
 * `safeStorage`, `shell.openExternal`, and the broadcast to windows.
 *
 * **Network.** Google's endpoints are reached with Node's own `fetch`, not Electron's `net.fetch`:
 * `net.fetch` goes through the default session, which is the editor's session and cancels every
 * remote request (`offline.ts`, deliberately untouched). The renderer still reaches nothing.
 */

import { app, BrowserWindow, safeStorage, shell } from 'electron'
import { readFile, rm, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import {
  HANDOFF_TIMEOUT_MS,
  REFERRAL_LIMIT,
  REVERIFY_INTERVAL_MS,
  isEntitled,
  looksLikeEmail,
  normaliseEmail,
  type AccessStatus,
  type ReferralResult
} from '@shared/access'
import { IPC } from '@shared/ipc'
import { applyVerification, canReverify, statusOf, type AccessRecord } from './policy'
import { accessBypass, allowedOrigins, browserSuppressed, siteOrigin } from './build'
import { startHandoff, type Handoff } from './handoff'
import { commit, readGrant, readReferralsUsed, referralCommitBody, refreshIdToken, userCreateBody, verifyAccess, type Fetch } from './google'
import { decodeAccessFile, encodeAccessFile, type Cipher } from './token-store'

const cipher: Cipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (sealed) => safeStorage.decryptString(sealed)
}

const netFetch: Fetch = (url, init) => fetch(url, init)

let bypass = false
let record: AccessRecord | null = null
let refreshToken: string | null = null
let persisted = true
/** A state that is not a function of the record: waiting on the browser, checking, a failed sign-in. */
let transient: AccessStatus | null = null
let handoff: Handoff | null = null
let verifying: Promise<void> | null = null
let timer: NodeJS.Timeout | null = null
let lastSent = ''
const listeners = new Set<(status: AccessStatus) => void>()

function filePath(): string {
  return join(app.getPath('userData'), 'access.json')
}

export function accessStatus(): AccessStatus {
  if (bypass) {
    return {
      state: 'entitled',
      email: 'dev bypass',
      lastVerifiedAt: Date.now(),
      lockAt: Number.MAX_SAFE_INTEGER,
      offline: false,
      persisted: true,
      referralsLeft: null,
      bypass: true
    }
  }
  return transient ?? statusOf(record, Date.now(), persisted)
}

export function accessEntitled(): boolean {
  return isEntitled(accessStatus())
}

export function onAccessChange(listener: (status: AccessStatus) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Pushes the status to every window and listener — only when it actually changed. */
function publish(): AccessStatus {
  const status = accessStatus()
  const key = JSON.stringify(status)
  if (key !== lastSent) {
    lastSent = key
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.accessChanged, status)
    }
    for (const listener of listeners) listener(status)
  }
  return status
}

async function save(): Promise<void> {
  const { bytes, persisted: sealed } = encodeAccessFile(record, refreshToken, cipher)
  persisted = sealed
  if (!sealed) {
    console.warn('[bay] access: the system keychain is unavailable, so the sign-in is kept in memory only until bay quits.')
  }
  const path = filePath()
  const temp = `${path}.tmp`
  try {
    await writeFile(temp, bytes, { mode: 0o600 })
    await rename(temp, path)
  } catch (error) {
    console.error(`[bay] access: could not save the access state: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Loads what is on disk and schedules verification. Call once, after `ready`. */
export async function startAccess(): Promise<AccessStatus> {
  bypass = accessBypass(process.env, app.isPackaged)
  if (bypass) {
    console.warn('[bay] access: BAY_ACCESS=dev in an unpackaged build — the access check is skipped.')
    return publish()
  }
  if (app.isPackaged && process.env['BAY_ACCESS'] === 'dev') {
    console.warn('[bay] access: BAY_ACCESS=dev is ignored in a packaged build.')
  }
  const bytes = await readFile(filePath()).catch(() => null)
  const loaded = decodeAccessFile(bytes, cipher)
  // A record whose token cannot be read (never persisted, or sealed by another keychain) cannot
  // be re-verified, so it is not a sign-in at all — unless it carries a lock, which must stand.
  record = loaded.refreshToken || loaded.record?.lock ? loaded.record : null
  refreshToken = loaded.refreshToken
  persisted = true
  const status = publish()
  void verifyInBackground()
  timer = setInterval(() => {
    void verifyInBackground()
  }, REVERIFY_INTERVAL_MS)
  // Crossing the 14-day line is a change of status with no event behind it; look hourly.
  const tick = setInterval(() => publish(), 60 * 60 * 1000)
  tick.unref()
  timer.unref()
  return status
}

export function stopAccess(): void {
  if (timer) clearInterval(timer)
  timer = null
  handoff?.cancel()
}

/** Re-verifies with the stored token. Nothing to do when signed out, locked, or already running. */
function verifyInBackground(): Promise<void> {
  if (verifying) return verifying
  if (!record || !refreshToken || !canReverify(record, Date.now())) return Promise.resolve()
  const token = refreshToken
  verifying = (async () => {
    const result = await verifyAccess(netFetch, token)
    // A sign-in or sign-out that happened meanwhile owns the state now.
    if (refreshToken !== token) return
    if (result.refreshToken) refreshToken = result.refreshToken
    const next = applyVerification(record, result.outcome, Date.now(), 'background')
    if (result.outcome.kind === 'network' || result.outcome.kind === 'error') {
      console.warn(`[bay] access: could not verify (${result.outcome.message}); working offline.`)
    }
    record = next
    await save()
    publish()
  })().finally(() => {
    verifying = null
  })
  return verifying
}

// -- sign-in ------------------------------------------------------------------------------

export async function signIn(): Promise<AccessStatus> {
  if (bypass) return accessStatus()
  handoff?.cancel()
  let started: Handoff
  try {
    started = await startHandoff({ allowedOrigins: allowedOrigins(app.isPackaged), timeoutMs: HANDOFF_TIMEOUT_MS })
  } catch (error) {
    transient = { state: 'error', message: `bay could not listen for the browser (${error instanceof Error ? error.message : String(error)}).` }
    return publish()
  }
  handoff = started
  const url = `${siteOrigin(process.env, app.isPackaged)}/desktop/sign-in?port=${started.port}&state=${encodeURIComponent(started.state)}`
  transient = { state: 'waiting', url, expiresAt: Date.now() + HANDOFF_TIMEOUT_MS }
  openInBrowser(url)
  void started.result.then((result) => finishSignIn(started, result))
  return publish()
}

function openInBrowser(url: string): void {
  if (browserSuppressed(process.env, app.isPackaged)) {
    console.log(`[bay] access: browser suppressed (BAY_ACCESS_NO_BROWSER=1); would open ${url}`)
    return
  }
  void shell.openExternal(url)
}

async function finishSignIn(started: Handoff, result: Awaited<Handoff['result']>): Promise<void> {
  if (handoff !== started) return // superseded by a newer sign-in
  handoff = null
  if (result.kind === 'cancelled') {
    transient = null
    publish()
    return
  }
  if (result.kind === 'timeout') {
    transient = { state: 'error', message: 'The browser sign-in was not finished within 5 minutes.' }
    publish()
    return
  }
  transient = { state: 'checking', email: null }
  publish()
  const verified = await verifyAccess(netFetch, result.refreshToken)
  const next = applyVerification(record, verified.outcome, Date.now(), 'sign-in')
  if (!next) {
    const outcome = verified.outcome
    transient = {
      state: 'error',
      message:
        outcome.kind === 'revoked'
          ? `Google refused the sign-in (${outcome.code}).`
          : outcome.kind === 'network'
            ? `bay could not reach Google to check your access (${outcome.message}).`
            : outcome.kind === 'error'
              ? outcome.message
              : 'The sign-in could not be checked.'
    }
    publish()
    return
  }
  record = next
  refreshToken = verified.refreshToken ?? result.refreshToken
  transient = null
  await save()
  const status = publish()
  const window = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (window && isEntitled(status)) {
    if (window.isMinimized()) window.restore()
    window.focus()
  }
}

export function cancelSignIn(): AccessStatus {
  handoff?.cancel()
  handoff = null
  transient = null
  return publish()
}

export async function signOut(): Promise<AccessStatus> {
  handoff?.cancel()
  handoff = null
  record = null
  refreshToken = null
  transient = null
  persisted = true
  await rm(filePath(), { force: true }).catch(() => undefined)
  return publish()
}

export async function recheck(): Promise<AccessStatus> {
  if (transient?.state === 'error') transient = null
  await verifyInBackground()
  return publish()
}

export function requestAccess(): void {
  openInBrowser(`${siteOrigin(process.env, app.isPackaged)}/waitlist`)
}

// -- referrals ----------------------------------------------------------------------------

export async function refer(input: string): Promise<ReferralResult> {
  const friend = normaliseEmail(input)
  if (bypass) {
    return { ok: false, reason: 'not-approved', error: 'Referrals need a signed-in account; this bay is running with BAY_ACCESS=dev.' }
  }
  if (!looksLikeEmail(friend)) return { ok: false, reason: 'invalid-email', error: `“${input}” is not an email address.` }
  if (!record || !refreshToken || !accessEntitled()) {
    return { ok: false, reason: 'not-approved', error: 'Only an account with access can refer someone. Sign in first.' }
  }
  if (friend === record.email) return { ok: false, reason: 'self', error: 'That is your own address — it already has access.' }

  const refreshed = await refreshIdToken(netFetch, refreshToken)
  if (refreshed.kind === 'network') {
    return { ok: false, reason: 'offline', error: `bay could not reach Google (${refreshed.message}). Try again when you are online.` }
  }
  if (refreshed.kind !== 'ok') {
    if (refreshed.kind === 'revoked') {
      record = applyVerification(record, refreshed, Date.now(), 'background')
      await save()
      publish()
    }
    return { ok: false, reason: 'failed', error: refreshed.kind === 'revoked' ? `Your sign-in is no longer valid (${refreshed.code}). Sign in again.` : refreshed.message }
  }
  refreshToken = refreshed.refreshToken
  const { idToken, claims } = refreshed

  let used = await readReferralsUsed(netFetch, idToken, claims.uid)
  if (used === null) return { ok: false, reason: 'offline', error: 'bay could not read your referral count. Try again.' }
  if (used === 'missing') {
    const created = await commit(netFetch, idToken, userCreateBody({ uid: claims.uid, email: record.email }))
    if (created.kind !== 'ok' && created.kind !== 'exists') {
      return { ok: false, reason: 'failed', error: 'bay could not set up your referral count, so nothing was granted. Try again.' }
    }
    used = 0
  }
  if (used >= REFERRAL_LIMIT) {
    await rememberReferrals(used)
    return { ok: false, reason: 'quota-used', error: `You have used all ${REFERRAL_LIMIT} of your referrals.` }
  }

  const result = await commit(netFetch, idToken, referralCommitBody({ friendEmail: friend, referrerEmail: record.email, uid: claims.uid }))
  switch (result.kind) {
    case 'ok':
      await rememberReferrals(used + 1)
      return { ok: true, email: friend, referralsLeft: REFERRAL_LIMIT - (used + 1) }
    case 'exists':
      return { ok: false, reason: 'already-has-access', error: `${friend} already has access to bay. No referral was used.` }
    case 'network':
      return { ok: false, reason: 'offline', error: `bay could not reach Firestore (${result.message}). No referral was used.` }
    case 'denied': {
      // The rules refused the pair. Find out which of the named reasons it was.
      const verified = await verifyAccess(netFetch, refreshToken)
      if (verified.outcome.kind === 'no-grant' || verified.outcome.kind === 'unverified-email') {
        record = applyVerification(record, verified.outcome, Date.now(), 'background')
        await save()
        publish()
        return { ok: false, reason: 'not-approved', error: 'Your account no longer has access, so it cannot refer anyone.' }
      }
      // The rules answer 403 for an existing grant too (it is evaluated as an update). A grant
      // this account made is readable by it; one someone else made is not.
      const grant = await readGrant(netFetch, idToken, friend)
      return grant === 'mine'
        ? { ok: false, reason: 'already-has-access', error: `You already referred ${friend}; they have access. No referral was used.` }
        : {
            ok: false,
            reason: 'already-has-access',
            error: `Firestore refused the referral: ${friend} may already have access through someone else, or the grant was refused. No referral was used.`
          }
    }
    case 'error':
      return { ok: false, reason: 'failed', error: `${result.message} No referral was used.` }
  }
}

async function rememberReferrals(used: number): Promise<void> {
  if (!record) return
  record = { ...record, referralsUsed: used }
  await save()
  publish()
}
