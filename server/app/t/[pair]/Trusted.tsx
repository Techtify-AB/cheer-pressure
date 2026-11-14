"use client";

import { useState } from "react";
import { checkName, checkText, charLength, TEXT_MAX } from "../../../lib/events";
import { MessagesError, timeline, type TimelineItem } from "../../../lib/messages";
import { Offline, Screen, Shell, statusLabel, when } from "../../../components/Shell";
import { takeParam, useMessages } from "../../../components/useMessages";

const PICKS: { text: string; kind: "greeting" | "question" }[] = [
  { text: "Thinking of you", kind: "greeting" },
  { text: "Walk after lunch?", kind: "question" },
  { text: "Call tonight?", kind: "question" },
];

type View = "home" | "send" | "waiting";

export default function Trusted({ pair }: { pair: string }) {
  const key = `cheerpressure.phone.trusted.${pair}`;
  const [invite, setInvite] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
  const [awaiting, setAwaiting] = useState<string | null>(null);

  const { client, snap, follow } = useMessages(key, (c) => {
    // Move the invite from the address into this phone's storage, then clean the address.
    const fromUrl = takeParam("i");
    if (fromUrl) localStorage.setItem(`${key}.invite`, fromUrl);
    const waitingFor = localStorage.getItem(`${key}.awaiting`);
    queueMicrotask(() => {
      setInvite(localStorage.getItem(`${key}.invite`));
      if (waitingFor) {
        setAwaiting(waitingFor);
        setView("waiting");
      }
    });
    return c.pairing() ? "follow" : "wait";
  });

  const remember = (clientId: string | null) => {
    if (clientId) localStorage.setItem(`${key}.awaiting`, clientId);
    else localStorage.removeItem(`${key}.awaiting`);
    setAwaiting(clientId);
  };

  if (!client) return <Shell>{null}</Shell>;

  const paired = client.pairing();
  if (!paired) {
    if (!invite) {
      return (
        <Shell>
          <Screen title="This link is not complete" line="Ask them to send the invite link again, and open it on this phone." />
        </Shell>
      );
    }
    return (
      <Shell>
        <NameStep
          onJoin={async (name) => {
            await client.join(window.location.origin, pair, invite, name);
            localStorage.removeItem(`${key}.invite`);
            setInvite(null);
            follow(client);
          }}
        />
      </Shell>
    );
  }

  const s = snap ?? client.snapshot();
  if (s.connection === "ended") {
    return (
      <Shell>
        <Screen
          title="This link has ended"
          line="Links last two days, or until they end them. Ask them for a new invite whenever you like."
        />
      </Shell>
    );
  }

  const items = timeline(s);
  const offline = s.connection === "offline";

  if (view === "send") {
    return (
      <Shell>
        <SendStep
          offline={offline}
          onBack={() => setView("home")}
          onSend={(text, kind) => {
            const out = client.sendGreeting(text, kind);
            remember(out.clientId);
            setView("waiting");
          }}
        />
      </Shell>
    );
  }

  if (view === "waiting" && awaiting) {
    const mine = items.find((it) => it.key === awaiting);
    const answer = mine?.id ? items.find((it) => it.type === "reply" && !it.own && it.replyTo === mine.id) : undefined;
    return (
      <Shell>
        <Waiting
          mine={mine}
          answer={answer}
          offline={offline}
          onDone={() => {
            remember(null);
            setView("home");
          }}
        />
      </Shell>
    );
  }

  // Home: is there a request from the person that nothing has been sent after?
  const lastRequest = [...items].reverse().find((it) => it.type === "contact_request" && !it.own);
  const open = lastRequest && !items.some((it) => it.own && Date.parse(it.ts) > Date.parse(lastRequest.ts));
  const name = s.trustedName;
  return (
    <Shell>
      <Screen
        title={name ? `Hi ${name}` : "Hi"}
        line={open ? undefined : "No requests right now. A few kind words are always welcome."}
        actions={
          <button type="button" className="primary" onClick={() => setView("send")}>
            Send a few words
          </button>
        }
      >
        <Offline show={offline} />
        {open ? (
          <div className="card request" role="status">
            <span className="from">{when(lastRequest.ts)}</span>
            <span className="text">They asked you to get in touch</span>
            {lastRequest.text ? <span className="hint">&ldquo;{lastRequest.text}&rdquo;</span> : null}
          </div>
        ) : null}
      </Screen>
    </Shell>
  );
}

function NameStep({ onJoin }: { onJoin: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const valid = checkName(name).ok;
  return (
    <form
      className="screen"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid || busy) return;
        setBusy(true);
        setProblem(null);
        try {
          await onJoin(name.trim());
        } catch (err) {
          const status = err instanceof MessagesError ? err.status : 0;
          setProblem(
            status === 0
              ? "You seem to be offline. Try again in a moment."
              : status === 401 || status === 404
                ? "This invite no longer works. Ask them for a new one."
                : "That did not work. Try again.",
          );
          setBusy(false);
        }
      }}
    >
      <div className="lead">
        <h1>What should they call you?</h1>
        <p>Your first name is enough. They will see it next to your messages.</p>
      </div>
      <div className="body">
        <div className="field">
          <label htmlFor="name">First name</label>
          <input
            id="name"
            className="input"
            autoComplete="given-name"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {problem ? (
          <p className="error" role="alert">
            {problem}
          </p>
        ) : null}
      </div>
      <div className="actions">
        <button type="submit" className="primary" disabled={!valid || busy}>
          {busy ? "One moment" : "Continue"}
        </button>
      </div>
    </form>
  );
}

function SendStep({
  offline,
  onSend,
  onBack,
}: {
  offline: boolean;
  onSend: (text: string, kind: "greeting" | "question") => void;
  onBack: () => void;
}) {
  const [own, setOwn] = useState("");
  const text = own.trim();
  const kind = text.endsWith("?") ? "question" : "greeting";
  const valid = checkText(text).ok;
  const left = TEXT_MAX - charLength(own.trim());
  return (
    <form
      className="screen"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSend(text, kind);
      }}
    >
      <div className="lead">
        <h1>Send a few words</h1>
        <p>Tap one to send it now, or write your own. A question gets a yes or no button.</p>
      </div>
      <div className="body">
        <fieldset className="picks">
          <legend className="visually-hidden">Send one of these now</legend>
          {PICKS.map((p) => (
            <button key={p.text} type="button" className="pick" onClick={() => onSend(p.text, p.kind)}>
              {p.text}
            </button>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor="own">Or write your own</label>
          <textarea
            id="own"
            className="textarea"
            value={own}
            maxLength={TEXT_MAX + 20}
            onChange={(e) => setOwn(e.target.value)}
          />
          {own.trim() ? (
            <span className={left < 0 ? "error" : "hint"}>{left < 0 ? `${-left} characters too long` : `${left} characters left`}</span>
          ) : null}
        </div>
        <Offline show={offline} />
      </div>
      <div className="actions">
        <button type="submit" className="primary" disabled={!valid}>
          Send
        </button>
        <button type="button" className="quiet" onClick={onBack}>
          Back
        </button>
      </div>
    </form>
  );
}

function Waiting({
  mine,
  answer,
  offline,
  onDone,
}: {
  mine: TimelineItem | undefined;
  answer: TimelineItem | undefined;
  offline: boolean;
  onDone: () => void;
}) {
  const title = answer
    ? answer.answer === "yes"
      ? "They said yes"
      : answer.answer === "no"
        ? "They said no"
        : "They wrote back"
    : mine?.status === "sent"
      ? mine.kind === "question"
        ? "Sent. Their answer shows up here."
        : "Sent. If they reply, it shows up here."
      : mine?.status === "waiting for connection"
        ? "Waiting for a connection"
        : mine?.status === "not sent"
          ? "This was not sent"
          : "Sending";
  return (
    <Screen
      title={title}
      actions={
        <button type="button" className="primary" onClick={onDone}>
          Done
        </button>
      }
    >
      <Offline show={offline} />
      {mine ? (
        <div className="card">
          <span className="from">You wrote</span>
          <span className="text">{mine.text}</span>
          <span className="status" data-status={mine.status} role="status">
            {statusLabel(mine.status)}
          </span>
        </div>
      ) : null}
      {answer && answer.answer === null ? (
        <div className="card">
          <span className="from">They wrote, {when(answer.ts)}</span>
          <span className="text">{answer.text}</span>
        </div>
      ) : null}
    </Screen>
  );
}
