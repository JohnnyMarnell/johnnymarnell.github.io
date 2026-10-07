# LEDs

I went to Burning Man for the first time in 2023. The camp I joined had begun an impressive LED light installation the year prior and were hoping to improve upon it.

With my help, we arrived at a dense 10,000+ LED ceiling grid with beautiful animations powered by a Raspberry Pi.

All LED pixels are individually addressable with custom diffuse tubing for smooth, bright, gorgeous colors.

I learned [LX Studio / Chromatik](https://chromatik.co/) (a.k.a. the Ableton Live of light) and wrote almost all the java code powering the animations.

Wanting to evangelize and crowd-source, I built reusable components (e.g. modulators tied to the beat of music) that any campmate could use to create new patterns with a UI.

I also ported the [Pixelblaze](https://electromage.com/pixelblaze/) universe to run on our system, giving us access to even more patterns.

**I'm most proud of the audio reactive capability I built**, especially realtime beat detection and syncing using the amazing python music ML library [Librosa](https://librosa.org/). Here's a [video](https://www.youtube.com/watch?v=wihCkwniqwU) demonstrating, as well as the [Jupyter notebook]({{ '/jupyter/tempo.html' | relative_url }}) I wrote for prototyping, full code [here](https://github.com/JohnnyMarnell/iqe?tab=readme-ov-file#audio-analysis).

I even wrote a custom webapp to control it over wifi from our phones. The overall effect was truly stunning, and we were so happy (and proud) to be contributing to the art there.

<div class="gallery" data-gallery data-base="{{ '/led/' | relative_url }}">
{%- for item in site.data.led.items %}
{% if item.video %}{% include video id=item.video alt=item.alt %}{% else %}{% include image src=item.image alt=item.alt %}{% endif %}
{%- endfor %}
</div>
