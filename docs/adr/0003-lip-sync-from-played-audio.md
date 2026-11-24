# Drive lip-sync from analysis of the audio being played, in the browser

Visemes are computed in the browser from the audio actually playing, not from TTS phoneme timings. This stays in sync with playback and barge-in whatever TTS engine is used, and works for Italian without a language-specific phoneme table. It sits behind a `LipSync` interface so phoneme-timed visemes can be added later.
