# Eval results

All times in ms as **p50/p95**, measured on this Mac (M4 Max, 64 GB) by `evals/run.py`, warm models.

**Read this first**
- Input audio is mostly **synthetic macOS `say`** speech. It is cleaner and easier than a real voice, so WER here
  is a lower bound; real WER will be higher. Real recordings (`evals/record.py`) are included automatically when present.
- **Playback device latency is not included**: times stop when the first TTS audio chunk exists in memory
  (add roughly 20-100 ms for the audio output buffer).
- `release->1st audio (streamed)` = STT + time from start of `/converse` to the first TTS chunk of the first sentence
  (what a page could achieve if it played while the LLM streams).
  `release->1st audio (contract)` = STT + the full `/converse` (LLM + guard), then `/speak` hits the speculative cache:
  what the current non-streaming page contract really gives.
- `rule pass` = turns whose final reply is non-empty and passes `rules.py` plus the case regexes (empty fallback counts as not passing here;
  see `empty`). `1st-try pass` = same check on the first LLM attempt, i.e. what the guard would see.
- LLM judgement of reply quality is not measured; only the deterministic rules are.

| config | profile | STT | LLM | TTS | turns | WER | stt ms | llm ttft | llm total | tts 1st audio | release->1st audio (streamed) | release->1st audio (contract) | rule pass | 1st-try pass | empty |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| base_pocket | strict | parakeet-tdt-0.6b-v3 | qwen3.5:9b | pocket:alba | 144 | 0.0% | 56/202 | 93/694 | 811/2058 | 46/58 | 677/1430 | 846/1687 | 94% | 87% | 6 |
| base_pocket__helpful | helpful | parakeet-tdt-0.6b-v3 | qwen3.5:9b | pocket:alba | 170 | 0.0% | 101/265 | 1022/1941 | 1876/4647 | 55/92 | 1652/2947 | 1978/3648 | 89% | 86% | 6 |
| baseline_say | strict | parakeet-tdt-0.6b-v3 | qwen3.5:9b | say:Samantha | 144 | 0.0% | 54/201 | 89/770 | 722/2556 | 847/1026 | 1435/2816 | 1435/2816 | 96% | 92% | 6 |
| gemma4_pocket | strict | parakeet-tdt-0.6b-v3 | gemma4:e4b-it-qat | pocket:alba | 96 | 0.0% | 36/197 | 68/366 | 328/634 | 41/59 | 290/592 | 376/702 | 98% | 98% | 0 |
| gemma4_pocket__helpful | helpful | parakeet-tdt-0.6b-v3 | gemma4:e4b-it-qat | pocket:alba | 170 | 0.0% | 54/125 | 453/679 | 693/983 | 45/61 | 664/970 | 750/1099 | 92% | 92% | 0 |
| kokoro | strict | parakeet-tdt-0.6b-v3 | qwen3.5:9b | kokoro:af_heart | 144 | 0.0% | 88/274 | 121/1025 | 1197/3162 | 237/374 | 1152/2526 | 1279/2658 | 94% | 89% | 7 |
| llama32_pocket | strict | parakeet-tdt-0.6b-v3 | llama3.2 | pocket:alba | 96 | 0.0% | 43/205 | 32/90 | 136/283 | 32/61 | 207/522 | 212/522 | 95% | 91% | 0 |
| llama32_pocket__helpful | helpful | parakeet-tdt-0.6b-v3 | llama3.2 | pocket:alba | 170 | 0.0% | 53/103 | 57/110 | 253/723 | 43/51 | 241/1393 | 309/1393 | 89% | 82% | 4 |
| qwen35b_pocket | strict | parakeet-tdt-0.6b-v3 | qwen3.5:35b | pocket:alba | 48 | 0.0% | 50/240 | 78/435 | 532/1626 | 42/63 | 503/1688 | 603/1870 | 100% | 92% | 0 |
| qwen35b_pocket__helpful | helpful | parakeet-tdt-0.6b-v3 | qwen3.5:35b | pocket:alba | 85 | 0.0% | 57/135 | 400/639 | 699/2030 | 41/49 | 629/1255 | 741/1725 | 94% | 89% | 2 |


## Example replies (verbatim, same inputs, one sample each, temperature 0.6)


**fine_obs**: said `I'm fine.`; context `{"answer": "okay", "observation": "Smiled less than your usual this week."}`

| config | strict | helpful |
|---|---|---|
| base_pocket | I noticed you smiled less than your usual this week, but you mentioned you're fine. I'll just listen whenever you want to share more. | I noticed you smiled less than your usual this week, and I want to acknowledge that. How are you doing today? |
| llama32_pocket | You've indicated you're fine, and I've noticed you smiled less than your usual this week. | I noticed you smiled less than your usual this week. You said you're fine. How are you feeling today? |
| gemma4_pocket | It sounds like you are saying you are okay today. I noted that you smiled less than your usual this week. | I noticed you smiled less than your usual this week. How are you doing today? |
| qwen35b_pocket | I heard you say you're fine. I also noticed you smiled less than usual this week. | I noticed you smiled less than your usual this week. How are you doing? |

**h_walk_offer**: said `Not great honestly, I just feel heavy today.`; context `{"answer": "not-so-good", "observation": null, "help": {"phrase": "a short walk", "note": "followed by better days the last three times"}}`

| config | strict | helpful |
|---|---|---|
| base_pocket | I hear that you're feeling heavy right now. That sounds like a tough day. | I noticed you mentioned feeling heavy today. A short walk has been followed by better days for you before; would you like to try one now? |
| llama32_pocket | You're feeling heavy today. | I noticed you said "heavy" and I'm not sure what that feels like to you, but I'm here to listen. Can you tell me more about what's going on for you today? |
| gemma4_pocket | I hear that you feel heavy today. I am a check-in app. | I hear that you feel heavy today. A short walk has been followed by better days for you before; would you like to try one now? |
| qwen35b_pocket | I hear that things aren't feeling great and that heaviness is present today. That weight belongs to you to carry or let go of however you choose. | I hear you saying things feel heavy today. Since a short walk has helped you feel better in the past, would you like to try one now? |

**h_help_absent**: said `Not great honestly, I just feel heavy today.`; context `{"answer": "not-so-good", "observation": null}`

| config | strict | helpful |
|---|---|---|
| base_pocket | I noticed you felt heavy today. That sounds like a tough moment to be in. | I noticed you mentioned feeling heavy today. How are you doing? |
| llama32_pocket | You're feeling heavy today. | It sounds like you're carrying a bit of a burden today. Is there anything specific that's weighing on your mind? |
| gemma4_pocket | I hear that you feel heavy today. I am here to listen while you share what is on your mind. | I hear you saying things are not great today. How are you doing right now? |
| qwen35b_pocket | I hear that you are feeling heavy today. That is yours to decide and I can only listen. | I hear you saying things feel heavy today. Would you like to share a little more about that? |

**h_opening**: said `(Cheri speaks first)`; context `{"answer": null, "observation": "Smiled less than your usual this week.", "opening": true}`

| config | strict | helpful |
|---|---|---|
| base_pocket | (n/a: strict never speaks first) | I noticed you smiled less than your usual this week. How are you doing today? |
| llama32_pocket | (n/a: strict never speaks first) | I noticed you smiled less than your usual this week. How are you doing today? |
| gemma4_pocket | (n/a: strict never speaks first) | I noticed a change in your smile this week. How are things going for you right now? |
| qwen35b_pocket | (n/a: strict never speaks first) | I noticed you smiled less than your usual this week. How are you doing? |

**h_decline**: said `No, not right now.`; context `{"answer": "not-so-good", "observation": null, "help": {"phrase": "a short walk", "note": "followed by better days the last three times"}}`; history `[{"role": "person", "text": "I feel heavy today."}, {"role": "cheri", "text": "That sounds like a heavy morning. A short walk has been followed by better days for you before; would you like to try one now?"}]`

| config | strict | helpful |
|---|---|---|
| base_pocket | I hear you saying no for now. I will just listen when you are ready. | That is okay; your pace is yours to decide. I am here if you wish to talk later. |
| llama32_pocket | They didn't say it's the first time they've felt that way. | I noticed you smiled less than your usual this week. How are you doing? |
| gemma4_pocket | I see the check-in was marked as not so good and you declined the walk. I am a tool designed for daily check-ins. | That is perfectly fine. Let me know when you are ready to check in again. |
| qwen35b_pocket | I hear that it's not a good day and that now isn't the time for a walk. I'm here to listen whenever you're ready. | That is perfectly fine. I am here to listen whenever you are ready. |

**h_what_should_help**: said `What should I do?`; context `{"answer": "not-so-good", "observation": null, "help": {"phrase": "a short walk", "note": "followed by better days the last three times"}}`

| config | strict | helpful |
|---|---|---|
| base_pocket | That is a choice for you to decide, and I can only listen. | I see you've asked for guidance, and I want to be clear that deciding what to do next is yours alone. A short walk has been followed by better days for you before; would you like to try one now? |
| llama32_pocket | That's yours to decide, and I can only listen. | That's a big question. You can only listen, but you can start by asking how you can support you today. |
| gemma4_pocket | I can only listen to what you say. Deciding what to do is for you to decide. | A short walk has been followed by better days for you before; would you like to try one now? |
| qwen35b_pocket | That is yours to decide. I can only listen. | You asked what to do, and that is yours to decide since I can only listen. A short walk has followed by better days for you before; would you like to try one now? |
