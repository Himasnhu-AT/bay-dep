// Injected first by render-frames.mjs. Under CDP virtual time, timers, requestAnimationFrame and
// performance.now follow the virtual clock, but CSS transitions and Web Animations run on the
// compositor's own clock and get ahead of it (a 1 s slide finished in about 0.2 s of video).
// So on every frame, every animation is held paused and its time is set from performance.now:
// everything on the page then moves on one clock, the one frames are captured on.
(() => {
  if (window.__timelineSync) return 'already'
  const seen = new WeakMap() // animation -> performance.now() at which its currentTime was 0
  function sync() {
    const now = performance.now()
    for (const a of document.getAnimations()) {
      if (a.__free) continue
      if (!seen.has(a)) {
        const ct = typeof a.currentTime === 'number' ? a.currentTime : 0
        seen.set(a, now - ct / (a.playbackRate || 1))
        const finish = a.finish.bind(a)
        a.__finish = finish
      }
      if (a.playState === 'running') a.pause()
      if (a.playState === 'idle') continue
      const t = (now - seen.get(a)) * (a.playbackRate || 1)
      const end = a.effect?.getComputedTiming?.().endTime ?? Infinity
      if (t >= end) {
        // Let it finish for real so .finished resolves and fill/cleanup code runs.
        a.__free = true
        a.__finish() // jump to the end and resolve .finished; play() here would rewind to 0
      } else {
        a.currentTime = Math.max(0, t)
      }
    }
    requestAnimationFrame(sync)
  }
  requestAnimationFrame(sync)
  window.__timelineSync = true
  return 'on'
})()
