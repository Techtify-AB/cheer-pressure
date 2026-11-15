from talk.face import sentence_from_face
from talk.prompt import SYSTEM, user_message


def test_face_sentences():
    assert sentence_from_face({"smile_share": 0.5, "valence": 0.2, "frames": 20}) == "They smiled while saying it."
    assert sentence_from_face({"smile_share": 0.0, "valence": -0.3, "frames": 20}) == "Their face stayed flat while saying it."
    assert sentence_from_face({"smile_share": 0.15, "valence": -0.3, "frames": 20}) is None
    assert sentence_from_face({"smile_share": 0.0, "valence": 0.0, "frames": 20}) is None
    assert sentence_from_face({"smile_share": 0.9, "valence": 0.9, "frames": 2}) is None
    assert sentence_from_face(None) is None


def test_face_sentence_has_no_labels_or_digits():
    s = sentence_from_face({"label": "Anger", "confidence": 0.9, "smile_share": 0.0, "valence": -0.5, "frames": 30})
    assert s and not any(c.isdigit() for c in s) and "anger" not in s.lower()


def test_user_message_and_budget():
    m = user_message("I slept badly", "not-so-good", "Smiled less than your usual this week.", "They smiled while saying it.")
    assert "not so good" in m and "I slept badly" in m and "usual" in m
    assert len(SYSTEM.split()) < 330  # ~400 token budget with the user message
    from talk.prompt import SYSTEM_HELPFUL
    assert len(SYSTEM_HELPFUL.split()) < 480  # longer since 15 Nov; static prefix, cached by Ollama
