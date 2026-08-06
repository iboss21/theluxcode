/**
 * Runtime enhancements for the RegesCore dashboard.
 *
 * Everything here attaches to the rendered DOM rather than editing
 * index.dc.html, so the next design export drops in over the old one and
 * nothing has to be re-patched by hand. That is the whole reason this file
 * exists as a separate script instead of a diff against the export.
 *
 * Navigation is driven by the export's own data-goto attributes, so clicking
 * an enhanced element does exactly what clicking the real nav item does. No
 * assumptions are made about how the app stores its current screen.
 *
 * RegesCore // Fable 5 - brand and engineering by davidio.dev
 */
(function () {
  'use strict'

  var HOME = 'command' // the Dashboard nav item: [data-goto="command"]
  var MARK = '__regescoreHome'

  function goHome() {
    var target = document.querySelector('[data-goto="' + HOME + '"]')
    if (!target) { window.location.reload(); return }
    // Deferred by a tick on purpose. Dispatching a second click while the
    // brand mark's own click is still propagating puts React's delegated root
    // listener in the middle of one event when the next arrives, and the state
    // update from the nested one is dropped - the observable symptom being a
    // logo that highlights on click and navigates nowhere. Firing after the
    // current dispatch unwinds makes it an ordinary nav click.
    setTimeout(function () { target.click() }, 0)
  }

  function makeHomeButton(el, label) {
    if (!el || el[MARK]) return false
    el[MARK] = true

    el.style.cursor = 'pointer'
    el.setAttribute('role', 'button')
    el.setAttribute('tabindex', '0')
    el.setAttribute('title', label + ' — back to Dashboard')
    el.setAttribute('aria-label', label + ', back to Dashboard')

    // A brand mark that does nothing on hover reads as decoration; a small
    // brightness lift is enough to say "this is a control" without touching
    // the layout or competing with the accent colour.
    el.style.transition = (el.style.transition ? el.style.transition + ', ' : '') + 'opacity .16s, filter .16s'
    el.addEventListener('mouseenter', function () { el.style.filter = 'brightness(1.25)' })
    el.addEventListener('mouseleave', function () { el.style.filter = '' })

    el.addEventListener('click', function (event) {
      event.preventDefault()
      event.stopPropagation()
      goHome()
    })
    el.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      goHome()
    })
    return true
  }

  /**
   * The two brand marks, found structurally rather than by index:
   *
   *   sidebar - the wolf image and the DAVIDIO/REGES.CORE label share a row,
   *             so the image's parent is the whole clickable block and the
   *             label comes along with it.
   *   header  - a row whose two children are exactly DAVIDIO and REGES.CORE.
   *
   * Matching on content means a reordered export still resolves correctly.
   */
  function wireBrandMarks() {
    var wired = 0

    var wolf = document.querySelector('img[src*="wolf"]')
    if (wolf && wolf.parentElement) {
      if (makeHomeButton(wolf.parentElement, 'RegesCore')) wired++
    }

    var texts = document.querySelectorAll('div, span')
    for (var i = 0; i < texts.length; i++) {
      var node = texts[i]
      if (node.children.length !== 0) continue
      if ((node.textContent || '').trim() !== 'DAVIDIO') continue

      var row = node.parentElement
      if (!row || row[MARK]) continue
      // Only the wordmark pair, never the 208px hero watermark, which is a
      // lone decorative node with no REGES.CORE sibling.
      if (!/REGES\.CORE/.test(row.textContent || '')) continue
      if (makeHomeButton(row, 'DAVIDIO REGES.CORE')) wired++
    }

    return wired
  }

  function start() {
    if (wireBrandMarks() >= 2) return

    // The dc runtime mounts asynchronously and re-renders on navigation, which
    // replaces these nodes. Observing keeps them wired for the whole session;
    // makeHomeButton is idempotent so repeated passes are free.
    var observer = new MutationObserver(function () { wireBrandMarks() })
    observer.observe(document.body, { childList: true, subtree: true })

    // Stop growing work on a long-lived dashboard once the app has settled.
    setTimeout(function () {
      observer.disconnect()
      var settled = new MutationObserver(function () { wireBrandMarks() })
      settled.observe(document.body, { childList: true })
    }, 30000)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
})()
