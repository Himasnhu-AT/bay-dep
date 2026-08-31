//! The WebKit half, which only ever runs in the child process.
//!
//! Everything here needs the main thread and a live run loop, which is the whole reason
//! `bay --html-shot` exists as a separate process. See the crate docs.

use std::cell::Cell;
use std::path::Path;
use std::rc::Rc;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{AllocAnyThread, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy, NSBackingStoreType, NSBitmapImageFileType,
    NSBitmapImageRep, NSImage, NSWindow, NSWindowStyleMask,
};
use objc2_foundation::{
    NSData, NSDate, NSDefaultRunLoopMode, NSDictionary, NSError, NSNumber,
    NSObjectNSKeyValueCoding, NSPoint, NSRect, NSRunLoop, NSSize, NSString, NSURL,
};
use objc2_web_kit::{WKSnapshotConfiguration, WKWebView, WKWebViewConfiguration};

use crate::{HtmlError, READY_SCRIPT, Rendered, Shot, Source, seek_script};

/// Rasterise one shot. Must be called on the process's main thread.
pub fn render(shot: &Shot, output: &Path) -> Result<Rendered, HtmlError> {
    let mtm = MainThreadMarker::new().ok_or_else(|| {
        HtmlError::Render("the renderer was not started on the main thread".to_string())
    })?;

    // Prohibited keeps this out of the Dock and out of the window server's focus list. Without
    // it, rendering an overlay would steal focus from whatever the user was typing into.
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Prohibited);

    let (out_width, out_height) = shot.output_size();
    let frame = NSRect::new(
        NSPoint::new(0.0, 0.0),
        NSSize::new(shot.width as f64, shot.height as f64),
    );

    let configuration = unsafe { WKWebViewConfiguration::new(mtm) };
    let web_view = unsafe {
        WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), frame, &configuration)
    };

    if shot.transparent {
        // `drawsBackground` has no public setter and is the only thing that stops WebKit
        // painting an opaque white page behind the content — which would make every overlay a
        // solid rectangle with the footage hidden behind it.
        let no = NSNumber::new_bool(false);
        unsafe {
            web_view.setValue_forKey(Some(&no), &NSString::from_str("drawsBackground"));
        }
    }

    // A web view outside a window is not guaranteed to lay out or paint. The window is
    // borderless and parked far off any display, so it is never visible; `orderBack` is enough
    // to get it into the window server without raising it over anything.
    let window = unsafe {
        NSWindow::initWithContentRect_styleMask_backing_defer(
            NSWindow::alloc(mtm),
            NSRect::new(
                NSPoint::new(-30000.0, -30000.0),
                NSSize::new(shot.width as f64, shot.height as f64),
            ),
            NSWindowStyleMask::Borderless,
            NSBackingStoreType::Buffered,
            false,
        )
    };
    window.setOpaque(false);
    window.setContentView(Some(&web_view));
    window.orderBack(None);

    load(shot, &web_view)?;

    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(shot.timeout_ms);
    wait_until_ready(&web_view, mtm, deadline)?;
    pump(mtm, shot.settle_ms);

    // Seeking is best-effort by design: a still card has no timeline, and that is not a fault.
    // A *named* timeline that is missing is a fault, because the caller asserted it exists.
    let verdict = evaluate_string(&web_view, mtm, &seek_script(shot), deadline)?;
    if let Some(verdict) = verdict.as_deref() {
        // Naming a timeline asserts it exists. Both "there is no registry" and "the registry
        // has no such key" mean the caller is wrong about the composition, and both used to
        // pass silently as frame zero — which would ship a whole animation as identical stills.
        if let Some(named) = shot.timeline_id.as_deref()
            && matches!(verdict, "no-such-timeline" | "no-timelines")
        {
            return Err(HtmlError::Render(format!(
                "the composition declares no timeline called {named:?} — \
                 window.__timelines has no such key"
            )));
        }
        if let Some(keys) = verdict.strip_prefix("ambiguous:") {
            return Err(HtmlError::Render(format!(
                "the composition declares more than one timeline ({keys}); \
                 name one with timelineId"
            )));
        }
        if verdict == "seeked" {
            // One more turn of the loop so the seeked frame is painted before it is snapped.
            pump(mtm, shot.settle_ms.max(32));
        }
    }

    let png = snapshot(&web_view, mtm, out_width, deadline)?;
    // WebKit snapshots at the display's backing scale, so this is where a 2x Retina capture is
    // brought back to the size the caller asked for — and where the reported dimensions start
    // being measured instead of assumed.
    let (png, width, height) = crate::conform(&png, (out_width, out_height))?;
    std::fs::write(output, &png).map_err(|source| HtmlError::Write {
        path: output.to_path_buf(),
        source,
    })?;

    let ink = crate::ink_of_png(&png)?;
    Ok(Rendered {
        path: output.to_path_buf(),
        width,
        height,
        ink,
    })
}

fn load(shot: &Shot, web_view: &WKWebView) -> Result<(), HtmlError> {
    match &shot.source {
        Source::File(path) => {
            let absolute = path.canonicalize().map_err(|source| HtmlError::Read {
                path: path.clone(),
                source,
            })?;
            // Read access is granted to the containing directory, not the file, so a
            // self-contained composition directory can reach its own fonts/ and vendor/.
            let directory = absolute.parent().unwrap_or(&absolute);
            let url = NSURL::fileURLWithPath(&NSString::from_str(&absolute.to_string_lossy()));
            let root = NSURL::fileURLWithPath(&NSString::from_str(&directory.to_string_lossy()));
            unsafe { web_view.loadFileURL_allowingReadAccessToURL(&url, &root) };
        }
        Source::Html(html) => {
            unsafe { web_view.loadHTMLString_baseURL(&NSString::from_str(html), None) };
        }
    }
    Ok(())
}

/// Turn the run loop for a while, letting WebKit make progress.
fn pump(mtm: MainThreadMarker, millis: u64) {
    let _ = mtm;
    let until = std::time::Instant::now() + std::time::Duration::from_millis(millis);
    loop {
        let slice = NSDate::dateWithTimeIntervalSinceNow(0.008);
        unsafe {
            NSRunLoop::currentRunLoop().runMode_beforeDate(NSDefaultRunLoopMode, &slice);
        }
        if std::time::Instant::now() >= until {
            break;
        }
    }
}

/// Wait for the document and its webfonts.
fn wait_until_ready(
    web_view: &WKWebView,
    mtm: MainThreadMarker,
    deadline: std::time::Instant,
) -> Result<(), HtmlError> {
    loop {
        if std::time::Instant::now() >= deadline {
            return Err(HtmlError::Timeout(0));
        }
        if !unsafe { web_view.isLoading() }
            && evaluate_bool(web_view, mtm, READY_SCRIPT, deadline).unwrap_or(false)
        {
            return Ok(());
        }
        pump(mtm, 16);
    }
}

/// Run JavaScript and wait for its answer.
///
/// The completion handler is called on the main thread, so the run loop has to keep turning
/// while we wait — a plain block-and-wait here deadlocks, which is the trap this function
/// exists to hide from its callers.
fn evaluate(
    web_view: &WKWebView,
    mtm: MainThreadMarker,
    script: &str,
    deadline: std::time::Instant,
) -> Result<Option<Retained<AnyObject>>, HtmlError> {
    let done = Rc::new(Cell::new(false));
    let slot: Rc<std::cell::RefCell<Option<Retained<AnyObject>>>> =
        Rc::new(std::cell::RefCell::new(None));
    let failure: Rc<std::cell::RefCell<Option<String>>> = Rc::new(std::cell::RefCell::new(None));

    let handler = {
        let done = done.clone();
        let slot = slot.clone();
        let failure = failure.clone();
        RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
            if !error.is_null() {
                let error = unsafe { Retained::retain(error) };
                if let Some(error) = error {
                    *failure.borrow_mut() = Some(error.localizedDescription().to_string());
                }
            } else if !value.is_null() {
                *slot.borrow_mut() = unsafe { Retained::retain(value) };
            }
            done.set(true);
        })
    };

    unsafe {
        web_view.evaluateJavaScript_completionHandler(&NSString::from_str(script), Some(&handler));
    }

    while !done.get() {
        if std::time::Instant::now() >= deadline {
            return Err(HtmlError::Render(
                "a script in the composition did not return in time".to_string(),
            ));
        }
        pump(mtm, 8);
    }

    if let Some(message) = failure.borrow().clone() {
        return Err(HtmlError::Render(message));
    }
    let value = slot.borrow_mut().take();
    Ok(value)
}

fn evaluate_bool(
    web_view: &WKWebView,
    mtm: MainThreadMarker,
    script: &str,
    deadline: std::time::Instant,
) -> Result<bool, HtmlError> {
    let value = evaluate(web_view, mtm, script, deadline)?;
    Ok(value
        .and_then(|value| value.downcast::<NSNumber>().ok())
        .is_some_and(|number| number.boolValue()))
}

fn evaluate_string(
    web_view: &WKWebView,
    mtm: MainThreadMarker,
    script: &str,
    deadline: std::time::Instant,
) -> Result<Option<String>, HtmlError> {
    let value = evaluate(web_view, mtm, script, deadline)?;
    Ok(value
        .and_then(|value| value.downcast::<NSString>().ok())
        .map(|string| string.to_string()))
}

/// Take the picture and encode it as PNG.
fn snapshot(
    web_view: &WKWebView,
    mtm: MainThreadMarker,
    out_width: u32,
    deadline: std::time::Instant,
) -> Result<Vec<u8>, HtmlError> {
    let configuration = unsafe { WKSnapshotConfiguration::new(mtm) };
    // `snapshotWidth` is in output pixels while the rect stays in CSS pixels, which is exactly
    // the separation `scale` needs: type is laid out at the authored size and rasterised larger.
    unsafe {
        configuration.setSnapshotWidth(Some(&NSNumber::new_u32(out_width)));
        configuration.setAfterScreenUpdates(true);
    }

    let done = Rc::new(Cell::new(false));
    let image: Rc<std::cell::RefCell<Option<Retained<NSImage>>>> =
        Rc::new(std::cell::RefCell::new(None));
    let failure: Rc<std::cell::RefCell<Option<String>>> = Rc::new(std::cell::RefCell::new(None));

    let handler = {
        let done = done.clone();
        let image = image.clone();
        let failure = failure.clone();
        RcBlock::new(move |value: *mut NSImage, error: *mut NSError| {
            if !error.is_null() {
                if let Some(error) = unsafe { Retained::retain(error) } {
                    *failure.borrow_mut() = Some(error.localizedDescription().to_string());
                }
            } else if !value.is_null() {
                *image.borrow_mut() = unsafe { Retained::retain(value) };
            }
            done.set(true);
        })
    };

    unsafe {
        web_view.takeSnapshotWithConfiguration_completionHandler(Some(&configuration), &handler);
    }

    while !done.get() {
        if std::time::Instant::now() >= deadline {
            return Err(HtmlError::Render(
                "WebKit did not return a snapshot in time".to_string(),
            ));
        }
        pump(mtm, 8);
    }

    if let Some(message) = failure.borrow().clone() {
        return Err(HtmlError::Render(message));
    }
    let image = image
        .borrow_mut()
        .take()
        .ok_or_else(|| HtmlError::Render("WebKit returned no image".to_string()))?;

    let tiff = image
        .TIFFRepresentation()
        .ok_or_else(|| HtmlError::Render("the snapshot could not be read back".to_string()))?;
    let rep = NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &tiff)
        .ok_or_else(|| HtmlError::Render("the snapshot was not a bitmap".to_string()))?;
    let empty: Retained<NSDictionary<_, AnyObject>> = NSDictionary::new();
    let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &empty) }
        .ok_or_else(|| HtmlError::Render("the snapshot could not be encoded as PNG".to_string()))?;

    Ok(bytes_of(&png))
}

fn bytes_of(data: &NSData) -> Vec<u8> {
    data.to_vec()
}
