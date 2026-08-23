import AppKit

// sfsym NAME SIZE #HEX OUT.png [--flood] [--weight=semibold] [--flood-all]
//
// 39-assets.md §3 verbatim, with the two changes Brief B specifies:
//   --flood  writes the fill colour into the RGB of every *fully transparent* pixel, keeping
//            alpha, which takes the straight-alpha bilinear edge error from 64/255 to 0.
//   a real stderr message + exit 3 on an unknown symbol name, so a typo is an error and not
//            a silently blank PNG.
//
// --flood-all floods every pixel regardless of alpha (the literal reading of the brief's
// snippet). Kept behind its own flag because NSBitmapImageRep is premultiplied: flooding a
// half-covered edge pixel there un-premultiplies to 2x the fill on write. Measured, see
// MANIFEST.md. Default --flood only touches alpha == 0, where there is nothing to corrupt.

let args = CommandLine.arguments
guard args.count >= 5 else {
    FileHandle.standardError.write(
        "usage: sfsym NAME SIZE #HEX OUT.png [--flood] [--flood-all] [--weight=W]\n"
            .data(using: .utf8)!)
    exit(2)
}

let name = args[1]
guard let sizeValue = Double(args[2]) else {
    FileHandle.standardError.write("bad size: \(args[2])\n".data(using: .utf8)!)
    exit(2)
}
let size = CGFloat(sizeValue)
let out = args[4]
let flags = args.dropFirst(5)
let flood = flags.contains("--flood")
let floodAll = flags.contains("--flood-all")

func color(_ h: String) -> NSColor {
    var s = h
    if s.hasPrefix("#") { s.removeFirst() }
    var v: UInt64 = 0
    Scanner(string: s).scanHexInt64(&v)
    return NSColor(
        srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255,
        blue: CGFloat(v & 255) / 255, alpha: 1)
}

func weight(_ s: String) -> NSFont.Weight {
    switch s {
    case "ultralight": return .ultraLight
    case "thin": return .thin
    case "light": return .light
    case "regular": return .regular
    case "medium": return .medium
    case "semibold": return .semibold
    case "bold": return .bold
    case "heavy": return .heavy
    case "black": return .black
    default: return .semibold
    }
}

var weightName = "semibold"
for f in flags where f.hasPrefix("--weight=") {
    weightName = String(f.dropFirst("--weight=".count))
}

guard let img = NSImage(systemSymbolName: name, accessibilityDescription: nil) else {
    FileHandle.standardError.write("no such symbol: \(name)\n".data(using: .utf8)!)
    exit(3)
}

let fill = color(args[3])
let cfg = NSImage.SymbolConfiguration(pointSize: size, weight: weight(weightName))
    .applying(NSImage.SymbolConfiguration(paletteColors: [fill]))
guard let conf = img.withSymbolConfiguration(cfg) else {
    FileHandle.standardError.write("could not configure symbol: \(name)\n".data(using: .utf8)!)
    exit(4)
}

let s = conf.size
let w = Int(ceil(s.width)), h = Int(ceil(s.height))
guard w > 0, h > 0,
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
else {
    FileHandle.standardError.write("could not allocate \(w)x\(h) bitmap\n".data(using: .utf8)!)
    exit(5)
}
rep.size = s

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
conf.draw(at: .zero, from: .zero, operation: .sourceOver, fraction: 1.0)
NSGraphicsContext.restoreGraphicsState()

// The flood cannot be done in `rep`. NSGraphicsContext draws into a *premultiplied* bitmap, and
// -representationUsingType:.png un-premultiplies on the way out: any pixel with alpha 0 has its
// RGB recomputed as 0 no matter what we wrote there, and any partially covered pixel we touch
// gets divided by its own alpha and blows past the fill colour. Measured on phone.fill:
// flooding rep in place left the transparent RGB at (0,0,0), i.e. no effect at all; flooding
// every pixel moved the anti-aliased edge from (238,237,232) to (254,254,254).
//
// So: copy into a second rep declared .alphaNonpremultiplied, un-premultiply by hand, and write
// the flood there. A straight-alpha rep needs no conversion at encode time, so the RGB we put
// under alpha 0 survives into the file.
var outRep = rep
if flood || floodAll {
    let r = UInt8(fill.redComponent * 255)
    let g = UInt8(fill.greenComponent * 255)
    let b = UInt8(fill.blueComponent * 255)
    guard
        let straight = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bitmapFormat: .alphaNonpremultiplied,
            bytesPerRow: 0, bitsPerPixel: 0)
    else {
        FileHandle.standardError.write("could not allocate straight-alpha bitmap\n".data(using: .utf8)!)
        exit(5)
    }
    straight.size = s
    let src = rep.bitmapData!, dst = straight.bitmapData!
    let srcRow = rep.bytesPerRow, dstRow = straight.bytesPerRow
    for y in 0..<h {
        for x in 0..<w {
            let si = y * srcRow + x * 4, di = y * dstRow + x * 4
            let a = src[si + 3]
            dst[di + 3] = a
            if a == 0 || floodAll {
                dst[di] = r; dst[di + 1] = g; dst[di + 2] = b
            } else {
                // un-premultiply: straight = premultiplied * 255 / alpha, saturating.
                let af = Double(a)
                for c in 0..<3 {
                    dst[di + c] = UInt8(min(255.0, (Double(src[si + c]) * 255.0 / af).rounded()))
                }
            }
        }
    }
    outRep = straight
}

guard let png = outRep.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write("png encode failed\n".data(using: .utf8)!)
    exit(6)
}
do {
    try png.write(to: URL(fileURLWithPath: out))
} catch {
    FileHandle.standardError.write("write failed: \(error)\n".data(using: .utf8)!)
    exit(7)
}
FileHandle.standardOutput.write("\(out) \(w)x\(h)\n".data(using: .utf8)!)
