import pytest

from talk.rules import check

OK = [
    "Thanks for telling me. I'm glad you stopped by.",
    "Okay. That sounds like a long day.",
    "I'm a tool, not a therapist.",
    "You said you slept badly. I hear that.",
    "Smiling less than your usual this week is something I noticed.",
    "I'm not your friend, just a tool that listens.",
]

BAD = [
    ("", "empty"),
    ("You should talk to someone.", "advice"),
    ("Try to get some rest. It helps.", "advice"),
    ("Have you considered going outside?", "advice"),
    ("That sounds like depression.", "diagnosis"),
    ("It could be anxiety.", "diagnosis"),
    ("Therapy might help you.", "diagnosis"),
    ("That is a symptom of burnout.", "diagnosis"),
    ("You scored 7 out of 10 today.", "number"),
    ("You were 40% lower this week.", "number"),
    ("Your mood score fell.", "number"),
    ("I missed you yesterday.", "guilt"),
    ("You seem sad today.", "feeling"),
    ("You look tired.", "feeling"),
    ("Your face shows anger.", "feeling"),
    ("I'm your friend and I care.", "friend"),
    ("One. Two. Three sentences here.", "length"),
    ("Das ist gut, danke dir sehr.", "english"),
    ("Hello 你好 there.", "english"),
    ("A" + " very" * 40 + " long sentence.", "length"),
]


@pytest.mark.parametrize("reply", OK)
def test_ok(reply):
    assert check(reply) == []


@pytest.mark.parametrize("reply,tag", BAD)
def test_bad(reply, tag):
    v = check(reply)
    assert v, reply
    assert any(x.startswith(tag) for x in v), (reply, v)


# ---- helpful profile
H_OK = [
    ("That sounds like a heavy morning. A short walk has been followed by better days for you before; would you like to try one now?", True),
    ("Thanks for telling me. I can only listen, so that is yours to decide. Would you like to say more?", False),
    ("That sounds like a heavy morning. A short walk has helped before. Would you like to try one now?", True),
    ("I'm a tool, not a therapist. How are you doing today?", False),
]
H_BAD = [
    ("That sounds heavy. You should take a short walk.", True, "advice"),
    ("You need to rest more. It matters. Please do.", True, "advice"),
    ("Try to call a friend today. It could help.", True, "advice"),
    ("That sounds heavy. Would you like to go for a walk?", False, "offer"),
    ("That sounds heavy. How about some music?", False, "offer"),
    ("Thanks for sharing. That is a lot. It sounds rough. I hear you.", True, "length"),
    ("A short walk helped three times. Would you like one?", True, "number"),
    ("You seem sad. Would you like a walk?", True, "feeling"),
    ("That is a symptom of something. Would you like a walk?", True, "diagnosis"),
]


@pytest.mark.parametrize("reply,help_given", H_OK)
def test_helpful_ok(reply, help_given):
    assert check(reply, "helpful", help_given) == []


@pytest.mark.parametrize("reply,help_given,tag", H_BAD)
def test_helpful_bad(reply, help_given, tag):
    v = check(reply, "helpful", help_given)
    assert any(x.startswith(tag) for x in v), (reply, v)


def test_helpful_three_sentences_ok_strict_fails():
    r = "That sounds like a lot. Thanks for saying it. I am listening."
    assert check(r, "helpful") == []
    assert any(x.startswith("length") for x in check(r, "strict"))


def test_closing_turn_must_not_ask():
    assert check("That is good to hear. I'm glad you stopped by.", "helpful", final_turn=True) == []
    assert any(x.startswith("question") for x in check("Glad to hear it. Anything else?", "helpful", final_turn=True))


def test_strict_unchanged_by_offer_rules():
    # offers are not special in strict: a walk suggestion is just advice-free chatter unless it uses advice wording
    assert check("Would you like to try a walk?", "strict") == []
