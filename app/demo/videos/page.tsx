// The films made for the pitch, playable in the browser. The files live in public/videos/, so
// the page works from any static host. Open to anyone: it does not ask for setup first.

const VIDEOS: { file: string; title: string; seconds: number }[] = [
  { file: "cheri_prequel_v2", title: "Sleep patterns", seconds: 30 },
  { file: "cheri_edit_v4", title: "Interactive follow up", seconds: 29 },
  { file: "cheri_social_v3", title: "Social", seconds: 28 },
  { file: "cheri_walk_v2", title: "The walk", seconds: 22 },
];

export default function VideosPage() {
  return (
    <div className="videos stack">
      <div className="stack-sm">
        <h1 className="item-title">Videos</h1>
        <p className="muted">Four short films made for the pitch. Each is about half a minute.</p>
      </div>
      {VIDEOS.map((v) => (
        <section key={v.file} className="card video-card stack-sm" aria-label={v.title}>
          <h2 className="video-title">
            {v.title} <span className="small muted">{v.seconds} seconds</span>
          </h2>
          <video controls playsInline preload="metadata" poster={`/videos/posters/${v.file}.jpg`}>
            <source src={`/videos/${v.file}.mp4`} type="video/mp4" />
            <a href={`/videos/${v.file}.mp4`}>Open the film</a>
          </video>
        </section>
      ))}
    </div>
  );
}
