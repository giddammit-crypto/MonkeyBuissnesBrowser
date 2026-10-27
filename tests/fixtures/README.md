# Local browser fixtures

`pip-video.webm` is a synthetic solid-color, silent 24-second VP8 video generated for PiP regression tests. It contains no third-party footage. Generate it with:

```sh
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=0x315b82:s=320x180:r=10 -t 24 -an -c:v libvpx -b:v 30k -y tests/fixtures/pip-video.webm
```

The committed file keeps the tests independent of FFmpeg and external media/network services.
