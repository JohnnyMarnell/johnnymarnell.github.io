# Johnny Marnell

👋🏻 Hey friend, welcome to my super-WiP, barest of the bones 🦴
GitHub pages site.

🎵❤️🤖 I'm a lover of all things music and technology, and their intersection.
I have a ton of hack projects I've started documenting here,
thanks for taking a look!

👷🏻 Professionally wise, I most recently worked as a Staff Engineer
at Spotify in the Advertising Business Unit.

# Music

  Music has always been a big part of my life, and I'm proud to say I've done some cool things with it.

  ⭐️ I co-wrote a [K-Pop record](https://www.youtube.com/watch?v=J2O6NZRLz2k)
     released by mega group [TWICE](https://www.instagram.com/twicetagram/).
     What a journey (listen to the evolution), originally
     [a Doo Wop throwback demo pitch](https://www.youtube.com/watch?v=o2qSVklbBXw)
     I wrote with castmates from a Bravo songwriting reality show,
     [Amber Riley of Glee recorded it](https://www.youtube.com/watch?v=tNP8GbRQDXk)
     but it sat for half a decade. ⭐️
  
  I was on a
  [Bravo TV reality show for songwriting](https://www.bravotv.com/platinum-hit).
  I won the most challenges on the show,
  including the [road trip one](https://www.youtube.com/watch?v=I48ROsiuTN4)
  **//** [reggae genre](https://www.youtube.com/watch?v=MXgx-s64tTs)
  **//** and challening Luda' on the
  [rap one too](https://www.youtube.com/watch?v=AuqssJiLj18) 😂.

  I toured with the incredible Ingrid Michaelson, played some huge venues like
  [Webster Hall in NYC](https://www.youtube.com/watch?v=tTkU9phbEGs).
  Never slept as well as I did on a tour bus!

  [Rockwood Music Hall](https://www.youtube.com/watch?v=GUgVvVJgpOQ)
  15 year anniversary, March 2020, days
  before everything changed forever.


# Some Projects

## Ableton / DAWs / Music

- [**Ableton Live Realtime Diff**](https://www.youtube.com/watch?v=mulwc2U11o8)
  Did you know Ableton Live Set (`.als`) files were just gzipped XML? ...you did? Well, quit your showboating. This hack surfaces realtime changes to the underlying file as you save
  **//**  [demo vid](https://www.youtube.com/watch?v=mulwc2U11o8)
  **//**  [src](https://github.com/JohnnyMarnell/ableton-live-realtime-changes)

- [**Ableton Live HTTP REST API**](https://www.youtube.com/watch?v=xfeG9-BbLko)
  Prototype of hacking a `SocketServer` into Ableton's undocumented, unofficial pythonsubsystem and API, for external control (e.g. with a custom web UI)
  **//**  [demo vid](https://www.youtube.com/watch?v=xfeG9-BbLko)
  **//**  [src](https://github.com/JohnnyMarnell/ableton-control?tab=readme-ov-file)

- [**REAPER / Network control / API**](https://github.com/JohnnyMarnell/j5-reaper)
  Built a custom Node.JS API to control REAPER. Hacked with Lua and REAPER's
  proprietary EEL script to successfully get a TCP server with
  ring buffer read/write working. Have sinced moved to custom API backed
  by OSC mappings (need to push). That's allowed me to build my Raspberry
  Pi looper
          [video](https://www.youtube.com/watch?v=gKP3OBteXtg)
  **//**  [source](https://github.com/JohnnyMarnell/j5-reaper)

- ⭐️ [**Gartrex 9000 Raspberry Pi Mobile Jam Loop Staishe**](https://www.youtube.com/watch?v=gKP3OBteXtg)
  Custom Node.JS looper, quantizer, swing, arranger. Headless REAPER.
  Custom compiled low latency Linux kernel.
  More info in this video (turn on CC / subtitles) and see description
  [here live from Mexico](https://www.youtube.com/watch?v=gKP3OBteXtg).
  Have taken this all over the world:
         [dive boats](https://www.youtube.com/watch?v=KVO8QH8ydek)
  **//** [weddings](https://www.youtube.com/watch?v=5gXpDlQAJRI)
  **//** [playing songs we never have before](https://www.youtube.com/watch?v=5gXpDlQAJRI) and beyond...


## More Audio Hacks

- ⭐️ [**10k+ LED Art installation**](/led-art.html)
  Java, Chromatik / LX Studio, Raspberry Pi plus Node.JS UI and python ML beat syncing

- ⭐️ [**Beat Detective**](/beat-detective.md)
  Live beat and tempo detection and synchronizing using python music ML Librosa powered predictions. [Jupyter notebook](./jupyter/tempo.html), quick [demo vid](https://youtu.be/wihCkwniqwU), plus see it live [here](/led-art.html)

- Coming Soon: Better write= up of my custom Raspberry Pi looper performance rig
- Coming Soon: ReModi, live jamming over the internet using MIDI over WebRTC / UDP (miraculously playable in
  the heart of quarantine with my best friends, NY <=> NJ <=> NC <=> IL)
- Coming Soon: Easy to use, custom REAPER API, currently powering [this magic](https://www.youtube.com/watch?v=gKP3OBteXtg)

- [**Bass Bounce Visualization**](https://www.youtube.com/watch?v=d0XzIzDG8k0)
  Built automatic audio reactive visualization based on FFT analyzed dynamic signals,
  Java with LX Studio. You can see the bounce start and stop depending on bass thumps

- [**Spotify Quarantine Halloween**](https://www.instagram.com/p/CG-u44ElvNk11U1LTU6wTNDM25x7Km-Vq7ns6o0)
  My band plus some teammates made a silly _"Hungry Like the Wolf"_ video
  for a company-wide Halloween themed quarantine live stream.
  Solely using Spotify's [SoundTrap](https://www.soundtrap.com/),
  a DAW that runs everywhere (even in the browser)

- [**Delay FX plugin - Spotify Hack Day**](https://www.youtube.com/watch?v=eJnJ6o7nmA4)
  Adding tempo sync'd note division to Delay FX, previously limited to only explicit time / milliseconds
  specifying

- [**MIDI Guitar**](https://www.youtube.com/watch?v=zNkmwI8Ubqs)
  I own both the [Jamstik Studio](https://jamstik.com/) guitar and the [Fishman TriplePlay](https://www.fishman.com/tripleplay/) pickup. This [video](https://www.youtube.com/watch?v=zNkmwI8Ubqs)
  is a zany quick one experimenting with the latter plus a fun orchestral patch that varies instruments depending on velocity and note range (e.g. timpani hit accents added when loud, different horn sections at higher registers). (...It was height of quarantine, please excuse the Snap filter cat lasers 😂).

- Coming Soon: Intelligent live use of MIDI guitar

- Coming Soon: How I'm approaching this site's code, improvements (it's so beautiful for starters, isn't it?...)

- Coming Soon (I hope 🤞🏻): Massive backlog

# Connect With Me

I love to collaborate on fun projects, let's talk.

- [LinkedIn](https://www.linkedin.com/in/johnnymarnell)
- [Instagram @johnnymarnell](https://www.instagram.com/johnnymarnell)
