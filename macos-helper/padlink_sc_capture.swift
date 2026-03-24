import AppKit
import Foundation
import ScreenCaptureKit

struct CaptureOptions {
    let displayId: UInt32
    let outputPath: String
    let quality: Double
}

enum CaptureError: Error {
    case missingArgument(String)
    case invalidArgument(String)
    case displayNotFound(UInt32)
    case encodeFailed
}

func parseOptions() throws -> CaptureOptions {
    var displayId: UInt32?
    var outputPath: String?
    var quality = 0.75

    for argument in CommandLine.arguments.dropFirst() {
        if argument.hasPrefix("--display-id=") {
            let value = String(argument.dropFirst("--display-id=".count))
            guard let parsed = UInt32(value) else {
                throw CaptureError.invalidArgument("display-id")
            }
            displayId = parsed
            continue
        }
        if argument.hasPrefix("--output=") {
            outputPath = String(argument.dropFirst("--output=".count))
            continue
        }
        if argument.hasPrefix("--quality=") {
            let value = String(argument.dropFirst("--quality=".count))
            guard let parsed = Double(value) else {
                throw CaptureError.invalidArgument("quality")
            }
            quality = min(1.0, max(0.1, parsed))
            continue
        }
    }

    guard let id = displayId else {
        throw CaptureError.missingArgument("display-id")
    }
    guard let output = outputPath, !output.isEmpty else {
        throw CaptureError.missingArgument("output")
    }
    return CaptureOptions(displayId: id, outputPath: output, quality: quality)
}

func printJson(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: []) else {
        return
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
}

func writeJpeg(image: CGImage, outputPath: String, quality: Double) throws -> Int {
    let nsImage = NSImage(cgImage: image, size: NSSize(width: image.width, height: image.height))
    guard
        let tiff = nsImage.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiff),
        let jpeg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: quality])
    else {
        throw CaptureError.encodeFailed
    }

    let url = URL(fileURLWithPath: outputPath)
    try jpeg.write(to: url, options: .atomic)
    return jpeg.count
}

func overlayCursorMarkerIfNeeded(image: CGImage, displayId: UInt32) -> CGImage {
    guard let event = CGEvent(source: nil) else {
        return image
    }

    let cursor = event.location
    let displayBounds = CGDisplayBounds(CGDirectDisplayID(displayId))
    if !displayBounds.contains(cursor) {
        return image
    }

    let width = image.width
    let height = image.height
    let scaleX = CGFloat(width) / max(displayBounds.width, 1)
    let scaleY = CGFloat(height) / max(displayBounds.height, 1)
    let markerX = (cursor.x - displayBounds.origin.x) * scaleX
    let markerY = CGFloat(height) - ((cursor.y - displayBounds.origin.y) * scaleY)

    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let context = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        return image
    }

    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    context.setFillColor(CGColor(red: 1, green: 0.1, blue: 0.1, alpha: 0.95))
    context.fillEllipse(in: CGRect(x: markerX - 6, y: markerY - 6, width: 12, height: 12))
    return context.makeImage() ?? image
}

@main
struct PadlinkScreenCaptureMain {
    static func main() async {
        do {
            let options = try parseOptions()
            let content = try await SCShareableContent.current
            guard let display = content.displays.first(where: { $0.displayID == options.displayId }) else {
                throw CaptureError.displayNotFound(options.displayId)
            }

            let filter = SCContentFilter(display: display, excludingWindows: [])
            let config = SCStreamConfiguration()
            config.showsCursor = true
            config.width = Int(display.frame.width)
            config.height = Int(display.frame.height)

            let captured = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            let withCursor = overlayCursorMarkerIfNeeded(image: captured, displayId: options.displayId)
            let bytes = try writeJpeg(image: withCursor, outputPath: options.outputPath, quality: options.quality)

            printJson([
                "displayId": options.displayId,
                "bytes": bytes,
                "output": options.outputPath
            ])
            exit(0)
        } catch CaptureError.missingArgument(let key) {
            fputs("capture-failed:missing-\(key)\n", stderr)
            exit(1)
        } catch CaptureError.invalidArgument(let key) {
            fputs("capture-failed:invalid-\(key)\n", stderr)
            exit(2)
        } catch CaptureError.displayNotFound(let displayId) {
            fputs("capture-failed:display-not-found-\(displayId)\n", stderr)
            exit(3)
        } catch CaptureError.encodeFailed {
            fputs("capture-failed:encode-failed\n", stderr)
            exit(4)
        } catch {
            fputs("capture-failed:\(error)\n", stderr)
            exit(5)
        }
    }
}
