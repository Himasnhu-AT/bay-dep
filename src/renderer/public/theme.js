/*
 * The theme, decided before anything paints.
 *
 * This is a classic (non-module) script loaded synchronously from <head>: the parser stops
 * here, so `data-theme` is on <html> before the stylesheet applies and before <body> exists.
 * A module script is deferred and would run after first paint, which is the flash this file
 * exists to prevent. It is a file rather than inline because the CSP is `script-src 'self'`,
 * and that stays true.
 *
 * It lives in `public/` so Vite copies it byte-for-byte instead of trying to bundle it.
 *
 * It is also the only implementation of the theme logic. The control in the top bar calls
 * `window.bayTheme` rather than re-deriving the key and the resolution, because a rule kept
 * in two places is re-decided independently.
 */
;(function () {
  var KEY = 'bay.theme'
  var PREFERENCES = ['dark', 'light', 'system']
  var root = document.documentElement
  var media = window.matchMedia('(prefers-color-scheme: dark)')

  function read() {
    try {
      var stored = window.localStorage.getItem(KEY)
      if (PREFERENCES.indexOf(stored) !== -1) return stored
    } catch (error) {
      // Storage can be unavailable; that is "no preference", not a failure.
    }
    // The editor's own look is dark. `system` is something a user opts into.
    return 'dark'
  }

  function apply(preference) {
    var resolved = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference
    root.setAttribute('data-theme', resolved)
  }

  function set(preference) {
    if (PREFERENCES.indexOf(preference) === -1) {
      throw new Error('theme must be one of ' + PREFERENCES.join(', ') + ', got ' + preference)
    }
    try {
      window.localStorage.setItem(KEY, preference)
    } catch (error) {
      // Applied for this session even when it cannot be remembered.
    }
    apply(preference)
  }

  // Following the OS live only matters while the preference is `system`.
  media.addEventListener('change', function () {
    if (read() === 'system') apply('system')
  })

  window.bayTheme = { get: read, set: set }

  apply(read())
})()
