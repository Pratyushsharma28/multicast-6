import CoreImage
import CoreMedia
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

/// A small helper used by the Electron sender. Capture data stays on stdout as
/// framed JPEG/status records; diagnostics go to stderr.
@main
struct MultiCastCapture {
    static func main() async {
        let arguments = Array(CommandLine.arguments.dropFirst())
        do {
            if arguments.first == "--list-displays" {
                try await listDisplays()
            } else if arguments.first == "--capture", arguments.count == 2,
                      let displayID = UInt32(arguments[1]) {
                try await capture(displayID: displayID)
            } else {
                fputs("Usage: multicast-capture --list-displays | --capture DISPLAY_ID\n", stderr)
                exit(EXIT_FAILURE)
            }
        } catch {
            if arguments.first == "--capture" {
                writeRecord(type: 2, data: jsonData(["type": "error", "message": error.localizedDescription]))
            } else {
                fputs("ScreenCaptureKit error: \(error.localizedDescription)\n", stderr)
            }
            exit(EXIT_FAILURE)
        }
    }

    private static func listDisplays() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let displays = content.displays.map { display in
            ["id": display.displayID, "width": display.width, "height": display.height] as [String: Any]
        }
        let data = try JSONSerialization.data(withJSONObject: ["displays": displays], options: [.sortedKeys])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0a]))
    }

    private static func capture(displayID: UInt32) async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
            throw CaptureError.displayUnavailable
        }

        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let configuration = SCStreamConfiguration()
        configuration.width = min(display.width, 1920)
        configuration.height = min(display.height, 1080)
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 15)
        configuration.queueDepth = 3
        configuration.pixelFormat = kCVPixelFormatType_32BGRA

        let output = FrameOutput()
        let stream = SCStream(filter: filter, configuration: configuration, delegate: output)
        try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: DispatchQueue(label: "com.multicast6.capture.frames"))
        try await stream.startCapture()
        writeRecord(type: 2, data: jsonData(["type": "started", "displayId": displayID]))

        // Keep the stream and its output delegate alive until Electron closes stdin.
        while !FileHandle.standardInput.availableData.isEmpty {
            try await Task.sleep(for: .milliseconds(250))
        }
        try await stream.stopCapture()
    }

    fileprivate static func writeRecord(type: UInt8, data: Data) {
        guard data.count <= Int(UInt32.max) else { return }
        var length = UInt32(data.count).bigEndian
        var header = Data([type])
        withUnsafeBytes(of: &length) { header.append(contentsOf: $0) }
        header.append(data)
        FileHandle.standardOutput.write(header)
    }

    private static func jsonData(_ value: [String: Any]) -> Data {
        (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8)
    }
}

private enum CaptureError: LocalizedError {
    case displayUnavailable
    var errorDescription: String? {
        "The selected display is no longer available. Refresh the display list and choose again."
    }
}

private final class FrameOutput: NSObject, SCStreamOutput, SCStreamDelegate {
    private let context = CIContext(options: [.cacheIntermediates: false])
    private let lock = NSLock()
    private var lastFrameTime = Date.distantPast

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, CMSampleBufferIsValid(sampleBuffer),
              let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        lock.lock()
        defer { lock.unlock() }
        let now = Date()
        guard now.timeIntervalSince(lastFrameTime) >= 1.0 / 15.0 else { return }
        lastFrameTime = now

        let image = CIImage(cvPixelBuffer: pixelBuffer)
        guard let cgImage = context.createCGImage(image, from: image.extent) else { return }
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { return }
        CGImageDestinationAddImage(destination, cgImage, [kCGImageDestinationLossyCompressionQuality: 0.72] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return }
        MultiCastCapture.writeRecord(type: 1, data: data as Data)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        let payload = (try? JSONSerialization.data(withJSONObject: ["type": "error", "message": error.localizedDescription])) ?? Data("{}".utf8)
        MultiCastCapture.writeRecord(type: 2, data: payload)
    }
}
