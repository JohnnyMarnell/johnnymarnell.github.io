#### Live Beat Sync with Librosa

<a href="https://www.youtube.com/watch?v=wihCkwniqwU">
<img src="https://img.youtube.com/vi/wihCkwniqwU/maxresdefault.jpg">
</a>
[**_☝🏻START HERE☝🏻: Quick Demo Video showing detection and sync_**](https://www.youtube.com/watch?v=wihCkwniqwU)

[**_See it Live with LEDs_**](./led-art.html)

[**_Jupyter Notebook Prototyping_**](./jupyter/tempo.html)

I read about and tried a few solutions for beat detection like Ableton's built-in BeatSeeker, but I couldn't get anything reliable. I decided to try my own approach using [Librosa](https://librosa.org), which is chock full of great stuff, including some beat/onset envelope detection algorithms.

I think it's mostly meant for batch analyzing long, predetermined audio files, whereas I want a Near Real-Time solution. It's my understanding that professional DJ live events will use already prepared metadata-tagged and beat-annotated audio files (like those through [Rekordbox](https://rekordbox.com)), whereas we'll be switching sound Bluetooth sound sources, playlists, and (hopefully soon) using it during playing live gigs with instruments and vocals.

My approach was to use python real time audio buffer handling (a new challenge for me to begin with, I've worked mostly with MIDI), and do periodic analysis on varying windows back in time (e.g. 5, 10 and 60 seconds). I tried a few libraries for this and found [PyAudio](https://pypi.org/project/PyAudio) to work the best.

The thinking is that, a song (often ~4 minutes) won't change tempo frequently nor drastically once it's being played, so we can use short predictions of the recent past to predict the next beats of the short term future (essentially just choosing one analyzed detected beat event and tempo in the near past, and adding multiples forward into the future, reassessing and averaging as we go).

I think it's working surprisingly well, even in early stages. Here's a [Jupyter notebook](./jupyter/tempo.html) with initial experimenting, plus a [video](https://www.youtube.com/watch?v=wihCkwniqwU)
using this model married with realtime processing of playing audio to fire [OSC](https://en.wikipedia.org/wiki/Open_Sound_Control) beat events.

Those events are sent to [LX Studio / Chromatik](https://chromatik.co/)
(a.k.a. the Ableton Live of light) and I have a simple custom pattern (radiating circles) firing from these beat events. We used this live with [our beautiful LEDs](./led-art.html) here as well.

Some source code [here](https://github.com/JohnnyMarnell/iqe?tab=readme-ov-file#audio-analysis).
