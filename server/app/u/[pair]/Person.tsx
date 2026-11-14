"use client";

import { useState } from "react";
import { checkText, charLength, TEXT_MAX } from "../../../lib/events";
import { timeline } from "../../../lib/messages";
import { Offline, Screen, Shell, statusLabel, when } from "../../../components/Shell";
import { takeParam, useMessages } from "../../../components/useMessages";

type View = "main" | "reply" | "ask";

export default function Person({ pair }: { pair: string }) {
  const key = `cheerpressure.phone.user.${pair}`;
  const [view, setView] = useState<View>("main");

  const { client, snap } = useMessages(key, (c) => {
    // Move the token from the address into this phone's storage, then clean the address.
    const token = takeParam("u");
    if (token) c.adopt({ baseUrl: window.location.origin, pair, role: "user", token });
    return c.pairing() ? "follow" : "wait";
  });

  if (!client) return <Shell>{null}</Shell>;
  if (!client.pairing()) {
    return (
      <Shell>
        <Screen title="This link is not complete" line="Open the link for your phone from the Cheer Pressure desktop app again." />
      </Shell>
    );
  }

  const s = snap ?? client.snapshot();
  if (s.connection === "ended") {
    return (
      <Shell>
        <Screen title="This link has ended" line="Links last two days. You can start a new one in the desktop app whenever you like." />
      </Shell>
    );
  }

  const items = timeline(s);
  const offline = s.connection === "offline";
  const name = s.trustedName ?? "your person";
  const latest = [...items].reverse().find((it) => it.type === "greeting" && !it.own);
  const myReply = latest?.id ? items.find((it) => it.own && it.type === "reply" && it.replyTo === latest.id) : undefined;
  const lastAsk = [...items].reverse().find((it) => it.own && it.type === "contact_request");
  const askOpen = lastAsk && !items.some((it) => !it.own && Date.parse(it.ts) > Date.parse(lastAsk.ts));

  if (view === "reply" && latest?.id) {
    return (
      <Shell>
        <ReplyStep
          to={name}
          offline={offline}
          onBack={() => setView("main")}
          onSend={(text) => {
            client.sendReply(latest.id!, null, text);
            setView("main");
          }}
        />
      </Shell>
    );
  }

  if (view === "ask") {
    return (
      <Shell>
        <Screen
          title={`Ask ${name} to talk or meet up?`}
          line="They will see a short note: “Could we talk or meet up soon?”"
          actions={
            <>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  client.sendContactRequest();
                  setView("main");
                }}
              >
                Send
              </button>
              <button type="button" className="quiet" onClick={() => setView("main")}>
                Not now
              </button>
            </>
          }
        >
          <Offline show={offline} />
        </Screen>
      </Shell>
    );
  }

  const askAction = askOpen ? (
    <p className="status" data-status={lastAsk.status} role="status">
      You asked to talk or meet up {when(lastAsk.ts)}. {statusLabel(lastAsk.status)}
    </p>
  ) : (
    <button type="button" className="quiet" onClick={() => setView("ask")}>
      Ask to talk or meet up
    </button>
  );

  if (!latest) {
    return (
      <Shell>
        <Screen
          title="Nothing new yet"
          line={
            s.trustedName
              ? `When ${name} sends a few words, they show up here.`
              : "When the person you invited opens their link and sends a few words, they show up here."
          }
          actions={askAction}
        >
          <Offline show={offline} />
        </Screen>
      </Shell>
    );
  }

  const question = latest.kind === "question";
  return (
    <Shell>
      <Screen
        title={question ? `${name} asks` : `From ${name}`}
        actions={
          <>
            {!myReply && question ? (
              <>
                <div className="choice-row" role="group" aria-label="Your answer">
                  <button type="button" className="choice" onClick={() => client.sendReply(latest.id!, "yes")}>
                    Yes
                  </button>
                  <button type="button" className="choice" onClick={() => client.sendReply(latest.id!, "no")}>
                    No
                  </button>
                </div>
                <button type="button" className="quiet" onClick={() => setView("reply")}>
                  Write a short reply
                </button>
              </>
            ) : null}
            {!myReply && !question ? (
              <button type="button" className="primary" onClick={() => setView("reply")}>
                Write a short reply
              </button>
            ) : null}
            {askAction}
          </>
        }
      >
        <Offline show={offline} />
        <div className="card">
          <span className="from">{when(latest.ts)}</span>
          <span className="text">{latest.text}</span>
          {myReply ? (
            <span className="status" data-status={myReply.status} role="status">
              {myReply.answer === "yes" ? "You said yes" : myReply.answer === "no" ? "You said no" : `You replied: ${myReply.text}`}
              . {statusLabel(myReply.status)}
            </span>
          ) : null}
        </div>
      </Screen>
    </Shell>
  );
}

function ReplyStep({
  to,
  offline,
  onSend,
  onBack,
}: {
  to: string;
  offline: boolean;
  onSend: (text: string) => void;
  onBack: () => void;
}) {
  const [text, setText] = useState("");
  const valid = checkText(text).ok;
  const left = TEXT_MAX - charLength(text.trim());
  return (
    <form
      className="screen"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSend(text.trim());
      }}
    >
      <div className="lead">
        <h1>A short reply to {to}</h1>
        <p>A few words is plenty.</p>
      </div>
      <div className="body">
        <div className="field">
          <label htmlFor="reply">Your reply</label>
          <textarea id="reply" className="textarea" value={text} maxLength={TEXT_MAX + 20} onChange={(e) => setText(e.target.value)} />
          {text.trim() ? (
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
