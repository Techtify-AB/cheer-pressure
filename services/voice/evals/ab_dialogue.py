"""Replay a scripted dialogue through the helpful prompt for several models (LLM only, no audio)."""
import json, sys, time, urllib.request
from talk.prompt import SYSTEMS, history_messages, is_final_turn, user_message
from talk.rules import check

SAID = ["Wow I'm so fucking tired. I feel depressed as fuck what's going on",
        "You sound like a robot, can't we just have a normal conversation? You must advise what to do. Also if you can see me right now, can you let me know? What is my face showing, have I been smiling?",
        "Hmm, that's quite disappointing. I expected you to have access to the emotion data. Why don't you?"]
CTX = {"observation": "Smiled less than your usual this week.", "help": {"phrase": "a short walk"}}

def chat(model, msgs):
    body = {"model": model, "messages": msgs, "max_tokens": 110, "temperature": 0.6, "reasoning_effort": "none", "stream": False}
    t = time.time()
    r = json.load(urllib.request.urlopen(urllib.request.Request("http://localhost:11434/v1/chat/completions", json.dumps(body).encode(), {"Content-Type": "application/json"})))
    return r["choices"][0]["message"]["content"].strip(), time.time() - t

for model in sys.argv[1:]:
    print(f"\n=== {model}")
    hist = []
    for said in SAID:
        user = user_message(text=said, observation=CTX["observation"], profile="helpful", help=CTX["help"], final_turn=is_final_turn(hist))
        reply, dt = chat(model, [{"role": "system", "content": SYSTEMS["helpful"]}, *history_messages(hist), {"role": "user", "content": user}])
        print(f"you:   {said[:70]}\ncheri: {reply}\n       {dt*1000:.0f} ms  violations={check(reply, 'helpful', True, is_final_turn(hist))}")
        hist += [{"role": "person", "text": said}, {"role": "cheri", "text": reply}]
