"use client";

// The films made for the pitch, as a small gallery in the order of the story. The files live in
// public/videos/, so the page works from any static host. Open to anyone: it does not ask for
// setup first. Each film shows its poster and one play button; the browser's own controls
// appear once it plays, and starting one film pauses the others.

import Link from "next/link";
import { useRef, useState } from "react";

interface Film {
  file: string;
  title: string;
  seconds: number;
}

const FILMS: Film[] = [
  { file: "cheri_prequel_v2", title: "Sleep patterns", seconds: 30 },
  { file: "cheri_edit_v4", title: "Interactive follow up", seconds: 29 },
  { file: "cheri_social_v3", title: "Social", seconds: 28 },
  { file: "cheri_walk_v2", title: "The walk", seconds: 22 },
];

function FilmCard({ film, number }: { film: Film; number: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  const pauseOthers = () => {
    document.querySelectorAll<HTMLVideoElement>(".video-frame video").forEach((v) => {
      if (v !== video.current) v.pause();
    });
  };

  return (
    <li className="video-item">
      <div className="video-frame">
        <video
          ref={video}
          controls={started}
          playsInline
          preload="metadata"
          poster={`/videos/posters/${film.file}.jpg`}
          aria-label={film.title}
          onPlay={() => {
            setStarted(true);
            pauseOthers();
          }}
          onEnded={() => {
            // Back to the poster and the play button.
            setStarted(false);
            video.current?.load();
          }}
        >
          <source src={`/videos/${film.file}.mp4`} type="video/mp4" />
        </video>
        {!started && (
          <button type="button" className="video-play" aria-label={`Play ${film.title}`} onClick={() => void video.current?.play()}>
            <span className="video-play-disc" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26">
                <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
              </svg>
            </span>
          </button>
        )}
      </div>
      <div className="video-meta">
        <span className="video-number">{number}</span>
        <h2 className="video-title">{film.title}</h2>
        <span className="video-length">{film.seconds} seconds</span>
      </div>
    </li>
  );
}

export default function VideosPage() {
  return (
    <div className="videos">
      <header className="videos-head">
        <p className="videos-eyebrow">Four short films</p>
        <h1 className="videos-title">Meet Cheri</h1>
        <p className="videos-lede">The story behind Cheer Pressure, in order. Each film is about half a minute.</p>
      </header>
      <ol className="videos-grid">
        {FILMS.map((film, i) => (
          <FilmCard key={film.file} film={film} number={i + 1} />
        ))}
      </ol>
      <div className="videos-foot">
        <Link href="/" className="btn btn-quiet">
          Open the app
        </Link>
      </div>
    </div>
  );
}
