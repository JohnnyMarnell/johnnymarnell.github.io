---
layout: gallery
title: LEDs
permalink: /led/
redirect_from: [ /leds, /led-art/, /led-art.html ]
---

# LEDs

I went to Burning Man for the first time in 2023. The camp I joined had begun an impressive LED light installation the year prior and were hoping to improve upon it.

With my help, we arrived at a dense 10,000+ LED ceiling grid with beautiful animations powered by a Raspberry Pi.

All LED pixels are individually addressable with custom diffuse tubing for smooth, bright, gorgeous colors.

I learned [LX Studio / Chromatik](https://chromatik.co/) (a.k.a. the Ableton Live of light) and wrote almost all the java code powering the animations.

Wanting to evangelize and crowd-source, I built reusable components (e.g. modulators tied to the beat of music) that any campmate could use to create new patterns with a UI.

I also ported the [Pixelblaze](https://electromage.com/pixelblaze/) universe to run on our system, giving us access to even more patterns.

**I'm most proud of the audio reactive capability I built**, especially realtime beat detection and syncing using the amazing python music ML library [Librosa](https://librosa.org/). Here's a [video](https://www.youtube.com/watch?v=wihCkwniqwU) demonstrating, as well as the [Jupyter notebook](./jupyter/tempo.html) I wrote for prototyping, full code [here](https://github.com/JohnnyMarnell/iqe?tab=readme-ov-file#audio-analysis).

I even wrote a custom webapp to control it over wifi from our phones. The overall effect was truly stunning, and we were so happy (and proud) to be contributing to the art there.

<div class="gallery">
{% include video id="Kg0VKvDbvkU" protrait=true alt="LEDs + RaspberryPi Alexander Jamilton" %}
{% include video id="n92QxOXHpaI" alt="LED curtain Brototype WiFi ArtNet Pixelblaze experiment" %}
{% include video id="qo0L7gmySvQ" alt="LED ceiling animation" %}
{% include video id="C8sHgpCKFPA" alt="LED patterns demo" %}
{% include video id="UL10vjc54Lw" alt="LED color transitions" %}
{% include video id="uXDbkIkoSk0" portrait=true alt="Vertical LED video" %}
{% include video id="nLRTtxrm7z0" portrait=true alt="Vertical LED patterns" %}
{% include video id="SzUIuTK63jA" portrait=true alt="Vertical LED show" %}
{% include image src="0328" alt="LED installation photo" %}
{% include image src="0488" alt="LED installation photo" %}
{% include image src="0494" alt="LED installation photo" %}
{% include image src="7415" alt="LED installation photo" %}
{% include image src="sweetman" alt="LED installation photo" %}
</div>