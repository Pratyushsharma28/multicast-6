import Foundation
import ScreenCaptureKit

@main
struct MultiCastCaptureProbe {
    static func main() async {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: true
            )
            let displays = content.displays.map { display in
                [
                    "id": display.displayID,
                    "width": display.width,
                    "height": display.height
                ] as [String: Any]
            }
            let result: [String: Any] = [
                "success": true,
                "framework": "ScreenCaptureKit",
                "displayCount": displays.count,
                "displays": displays,
                "captureStarted": false
            ]
            writeJSON(result)
        } catch {
            let result: [String: Any] = [
                "success": false,
                "framework": "ScreenCaptureKit",
                "captureStarted": false,
                "error": error.localizedDescription,
                "nextStep": "Allow MultiCast Capture Probe in System Settings > Privacy & Security > Screen Recording, then run it again."
            ]
            writeJSON(result)
            exit(EXIT_FAILURE)
        }
    }

    private static func writeJSON(_ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]),
              let output = String(data: data, encoding: .utf8) else {
            fputs("Could not encode probe result as JSON.\n", stderr)
            exit(EXIT_FAILURE)
        }
        print(output)
    }
}
