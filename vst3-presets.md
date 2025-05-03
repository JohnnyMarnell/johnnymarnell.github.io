#### VST3 Preset Handling

VST3 Preset files (extension `.vstpreset`) seem to have a better chance of
working with DAWs. E.g. if I add or edit a (nested even) directory
of them at correctly named `~/Library/Audio/Presets/<Company>/<Plugin>`,
the standard REAPER preset browser works great.

This is wonderful since plugin binaries often do their own shenanigans
with in GUI browsers that are frequently impossible to automate.

An older, (slightly?) less standard preset format I see is `.fxp`. I've seen
at least both the great free, OSS [Surge XT Synth](https://surge-synthesizer.github.io/)
and [Leapwing](https://www.leapwingaudio.com/) plugins using them.

Using an awesome repo from [janminor](https://github.com/janminor), I was able
to modify it to convert `.fxp` to `.vstpreset`,
my code [here](https://github.com/JohnnyMarnell/python-vstpreset/blob/main/fxptovst3.py).

I was able to port all ~3.3k of the wonderful presets bundled with the amazing
[Surge XT Synth](https://surge-synthesizer.github.io/), posted here:

> 🎵🤖 <br/>
> [**_surge-xt-fxp-to-vstpreset.7z_**](https://drive.google.com/file/d/13lhBb1NAENP85y7drFsfbrZsr9Wy_EWq/view?usp=drive_link)
>

#### To-Do:

- Post about how I want to use my new Novation Launchkey MK4 endless rotary encoders and
  sweet OLED screen to play with all these presets.