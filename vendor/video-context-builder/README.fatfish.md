# Video Context Builder

Vendored from https://github.com/Bigesila-B/video-context-builder-skills at commit
`44be7e702255126432cbfcb018e2e4c112e27a0c`. Copyright (c) 2026 Bigesila-B;
licensed under MIT; see LICENSE.

Fatfish uses the scripts through `python/video_context_helper.py`. The only local
change to upstream scripts is an opt-in FFmpeg protocol whitelist in
`scripts/ffmpeg_utils.py` when `FATFISH_RESTRICT_MEDIA=1`.
