// A small static file server on 127.0.0.1 for the web interface bundled into the app (web/, copied
// from the repository's out/ by scripts/copy-web.mjs). Why not file://: the static export links its
// files from the root ("/_next/static/..."), its pages are folders with trailing slashes
// ("/settings/" is settings/index.html) and the router fetches "/settings/index.txt" on a tap. From
// file:// all three point at the root of the phone's disk. An http origin on a fixed port also
// keeps localStorage in one place across launches and counts as a secure context for the camera.
//
// GET and HEAD only, one request per connection, byte ranges for audio and video, nothing outside
// the bundle folder. It listens on the loopback address only, so nothing else on the network can
// reach it.

import Foundation
import Network

final class BundleServer {
  let root: URL
  let port: UInt16
  private var listener: NWListener?
  private let queue = DispatchQueue(label: "app.cheerpressure.bundle-server")
  private(set) var isReady = false

  init(root: URL, port: UInt16) {
    self.root = root.standardizedFileURL
    self.port = port
  }

  /// Starts listening (again, if iOS closed the socket while the app was away). Calls back once.
  func start(_ done: @escaping (Error?) -> Void) {
    queue.async {
      if self.isReady, self.listener != nil {
        done(nil)
        return
      }
      self.listener?.cancel()
      do {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: self.port)!)
        let l = try NWListener(using: params)
        var answered = false
        l.stateUpdateHandler = { [weak self] state in
          switch state {
          case .ready:
            self?.isReady = true
            if !answered { answered = true; done(nil) }
          case .failed(let e):
            self?.isReady = false
            self?.listener = nil
            l.cancel()
            if !answered { answered = true; done(e) }
          case .cancelled:
            self?.isReady = false
          default:
            break
          }
        }
        l.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
        self.listener = l
        l.start(queue: self.queue)
      } catch {
        done(error)
      }
    }
  }

  private func accept(_ conn: NWConnection) {
    conn.start(queue: queue)
    read(conn, buffer: Data())
  }

  private func read(_ conn: NWConnection, buffer: Data) {
    conn.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) { [weak self] data, _, complete, error in
      guard let self else { return }
      var buf = buffer
      if let data { buf.append(data) }
      if let end = buf.range(of: Data("\r\n\r\n".utf8)) {
        let head = String(decoding: buf[..<end.lowerBound], as: UTF8.self)
        self.respond(conn, head: head)
      } else if complete || error != nil || buf.count > 64 * 1024 {
        conn.cancel()
      } else {
        self.read(conn, buffer: buf)
      }
    }
  }

  private func respond(_ conn: NWConnection, head: String) {
    let lines = head.components(separatedBy: "\r\n")
    let parts = (lines.first ?? "").split(separator: " ")
    guard parts.count >= 2 else { return send(conn, status: 400, headers: [:], body: Data(), head: false) }
    let method = String(parts[0])
    guard method == "GET" || method == "HEAD" else {
      return send(conn, status: 405, headers: ["Allow": "GET, HEAD"], body: Data(), head: false)
    }
    var headers: [String: String] = [:]
    for line in lines.dropFirst() {
      if let i = line.firstIndex(of: ":") {
        headers[line[..<i].lowercased()] = line[line.index(after: i)...].trimmingCharacters(in: .whitespaces)
      }
    }
    let target = String(parts[1])
    let rawPath = String(target.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first ?? "/")
    let path = rawPath.removingPercentEncoding ?? rawPath
    let isHead = method == "HEAD"

    switch resolve(path) {
    case .file(let url):
      serveFile(conn, url: url, range: headers["range"], head: isHead, status: 200)
    case .redirect(let to):
      let query = target.contains("?") ? "?" + (target.split(separator: "?", maxSplits: 1).last ?? "") : ""
      send(conn, status: 308, headers: ["Location": to + query], body: Data(), head: isHead)
    case .missing:
      let notFound = root.appendingPathComponent("404.html")
      if FileManager.default.fileExists(atPath: notFound.path) {
        serveFile(conn, url: notFound, range: nil, head: isHead, status: 404)
      } else {
        send(conn, status: 404, headers: ["Content-Type": "text/plain; charset=utf-8"], body: Data("Not here.".utf8), head: isHead)
      }
    }
  }

  private enum Resolved { case file(URL), redirect(String), missing }

  /// "/" and "/settings/" are their folder's index.html; "/settings" without the slash is sent
  /// to "/settings/" (the export's trailing slashes); a file is itself. Never outside the root.
  private func resolve(_ path: String) -> Resolved {
    guard path.hasPrefix("/"), !path.contains("\0") else { return .missing }
    let fm = FileManager.default
    let url = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
    guard url.path == root.path || url.path.hasPrefix(root.path + "/") else { return .missing }
    var isDir: ObjCBool = false
    if fm.fileExists(atPath: url.path, isDirectory: &isDir) {
      if !isDir.boolValue { return .file(url) }
      let index = url.appendingPathComponent("index.html")
      guard fm.fileExists(atPath: index.path) else { return .missing }
      return path.hasSuffix("/") ? .file(index) : .redirect(path + "/")
    }
    let html = URL(fileURLWithPath: url.path + ".html")
    if fm.fileExists(atPath: html.path) { return .file(html) }
    return .missing
  }

  /// Whether a page exists in the bundle, for opening a notification's screen.
  func hasPage(_ path: String) -> Bool {
    if case .file = resolve(path) { return true }
    if case .redirect = resolve(path) { return true }
    return false
  }

  private func serveFile(_ conn: NWConnection, url: URL, range: String?, head: Bool, status: Int) {
    guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else {
      return send(conn, status: 500, headers: [:], body: Data(), head: head)
    }
    var h: [String: String] = [
      "Content-Type": BundleServer.mime(url.pathExtension),
      "Accept-Ranges": "bytes",
      // Hashed build files never change; pages and everything else are checked every time, so an
      // updated app never shows yesterday's interface.
      "Cache-Control": url.path.contains("/_next/static/") ? "public, max-age=31536000, immutable" : "no-cache",
    ]
    if let range, status == 200, let (start, end) = BundleServer.byteRange(range, size: data.count) {
      h["Content-Range"] = "bytes \(start)-\(end)/\(data.count)"
      return send(conn, status: 206, headers: h, body: data.subdata(in: start..<(end + 1)), head: head)
    }
    if range != nil, status == 200, BundleServer.byteRange(range!, size: data.count) == nil, data.count > 0 {
      return send(conn, status: 416, headers: ["Content-Range": "bytes */\(data.count)"], body: Data(), head: head)
    }
    send(conn, status: status, headers: h, body: data, head: head)
  }

  /// One range of "bytes=a-b", "bytes=a-" or "bytes=-n"; nil when it cannot be served.
  static func byteRange(_ header: String, size: Int) -> (Int, Int)? {
    guard header.hasPrefix("bytes="), size > 0 else { return nil }
    let spec = header.dropFirst(6).split(separator: ",").first.map(String.init) ?? ""
    let ab = spec.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
    guard ab.count == 2 else { return nil }
    if ab[0].isEmpty {
      guard let n = Int(ab[1]), n > 0 else { return nil }
      return (max(0, size - n), size - 1)
    }
    guard let a = Int(ab[0]), a < size else { return nil }
    let b = ab[1].isEmpty ? size - 1 : min(Int(ab[1]) ?? (size - 1), size - 1)
    return b >= a ? (a, b) : nil
  }

  private func send(_ conn: NWConnection, status: Int, headers: [String: String], body: Data, head: Bool) {
    var text = "HTTP/1.1 \(status) \(BundleServer.reason(status))\r\n"
    var all = headers
    all["Content-Length"] = String(body.count)
    all["Connection"] = "close"
    all["X-Content-Type-Options"] = "nosniff"
    for (k, v) in all { text += "\(k): \(v)\r\n" }
    text += "\r\n"
    var out = Data(text.utf8)
    if !head { out.append(body) }
    conn.send(content: out, completion: .contentProcessed { _ in conn.cancel() })
  }

  static func reason(_ s: Int) -> String {
    switch s {
    case 200: return "OK"
    case 206: return "Partial Content"
    case 308: return "Permanent Redirect"
    case 400: return "Bad Request"
    case 404: return "Not Found"
    case 405: return "Method Not Allowed"
    case 416: return "Range Not Satisfiable"
    default: return "Error"
    }
  }

  static func mime(_ ext: String) -> String {
    switch ext.lowercased() {
    case "html", "htm": return "text/html; charset=utf-8"
    case "js", "mjs": return "text/javascript; charset=utf-8"
    case "css": return "text/css; charset=utf-8"
    case "json", "map": return "application/json; charset=utf-8"
    case "webmanifest": return "application/manifest+json"
    case "txt": return "text/plain; charset=utf-8"
    case "md": return "text/markdown; charset=utf-8"
    case "svg": return "image/svg+xml"
    case "png": return "image/png"
    case "jpg", "jpeg": return "image/jpeg"
    case "webp": return "image/webp"
    case "gif": return "image/gif"
    case "ico": return "image/x-icon"
    case "woff2": return "font/woff2"
    case "woff": return "font/woff"
    case "ttf": return "font/ttf"
    case "wasm": return "application/wasm"
    case "mp3": return "audio/mpeg"
    case "m4a", "aac": return "audio/mp4"
    case "wav": return "audio/wav"
    case "ogg", "oga": return "audio/ogg"
    case "mp4": return "video/mp4"
    case "webm": return "video/webm"
    case "glb": return "model/gltf-binary"
    case "gltf": return "model/gltf+json"
    default: return "application/octet-stream"
    }
  }
}
