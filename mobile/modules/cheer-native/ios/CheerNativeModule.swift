// The phone app's own native code, for what neither Expo nor the libraries in package.json do:
// serving the bundled web interface (BundleServer.swift), the camera and microphone permissions,
// and the audio session. Read from JavaScript through modules/cheer-native/index.ts.

import AVFoundation
import ExpoModulesCore

/// Fixed, so the page's origin (and with it localStorage) is the same on every launch.
let bundlePort: UInt16 = 41473

public class CheerNativeModule: Module {
  private var server: BundleServer?

  private var webRoot: URL? {
    guard let url = Bundle.main.resourceURL?.appendingPathComponent("web"),
          FileManager.default.fileExists(atPath: url.appendingPathComponent("index.html").path) else { return nil }
    return url
  }

  public func definition() -> ModuleDefinition {
    Name("CheerNative")

    Constants([
      "bundlePort": Int(bundlePort),
    ])

    /// True when the web interface was copied into this build (npm run web:copy before building).
    Function("hasWebBundle") { () -> Bool in
      self.webRoot != nil
    }

    /// Starts (or restarts, after the app was away) the server for the bundled interface.
    AsyncFunction("startBundleServer") { (promise: Promise) in
      guard let root = self.webRoot else {
        promise.reject("no-bundle", "The web interface is not in this build. Run npm run web:copy, then build again.")
        return
      }
      let server = self.server ?? BundleServer(root: root, port: bundlePort)
      self.server = server
      server.start { error in
        if let error {
          promise.reject("server", "Could not start the bundled interface on port \(bundlePort): \(error.localizedDescription)")
        } else {
          promise.resolve("http://127.0.0.1:\(bundlePort)")
        }
      }
    }

    /// Whether a screen ("/hello/") exists in the bundled interface.
    Function("hasBundledPage") { (path: String) -> Bool in
      guard let root = self.webRoot else { return false }
      return (self.server ?? BundleServer(root: root, port: bundlePort)).hasPage(path)
    }

    /// "granted", "denied" or "not-asked" for "camera" or "microphone".
    Function("mediaPermission") { (kind: String) -> String in
      CheerNativeModule.state(AVCaptureDevice.authorizationStatus(for: kind == "camera" ? .video : .audio))
    }

    /// Shows the system question once; after that only Settings can change the answer.
    AsyncFunction("requestMediaPermission") { (kind: String, promise: Promise) in
      let type: AVMediaType = kind == "camera" ? .video : .audio
      let now = AVCaptureDevice.authorizationStatus(for: type)
      if now != .notDetermined {
        promise.resolve(CheerNativeModule.state(now))
        return
      }
      AVCaptureDevice.requestAccess(for: type) { granted in
        promise.resolve(granted ? "granted" : "denied")
      }
    }

    /// Sound from the page plays even with the silent switch on (the person opened Cheri on
    /// purpose, and her voice is the point of the daily hello), mixed with whatever else is
    /// playing rather than stopping it. No background audio: it stops when the app is left.
    Function("configureAudio") { () -> Bool in
      do {
        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
        return true
      } catch {
        return false
      }
    }
  }

  static func state(_ s: AVAuthorizationStatus) -> String {
    switch s {
    case .authorized: return "granted"
    case .denied, .restricted: return "denied"
    default: return "not-asked"
    }
  }
}
