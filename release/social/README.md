# X launch drafts

Status: prepared for review; no post or quote-post has been sent.

## Project introduction

- `open-jev-introduction.mp4`: 52 seconds, 1280×720, 24 fps, silent H.264 with on-screen explanations.
- Covers the decision interface, a customer cancellation judgment, an 8×8 image reconstructed from saved pixel decisions, and an arithmetic choice.
- The displayed model responses are from the completed 9B full-pass checkpoint. The release includes 2B and 9B; this video does not claim that both models produced these examples.
- Attach this video to the standalone `launch-post.txt` draft.

## Successful demo reel

- `open-jev-demos.mp4`: about 1 minute 50 seconds, with clear non-game examples followed by full Doom, runner and Wiki episodes.
- Game footage replays the original 9B pilot's saved actions. Native Doom imagery is recorded from ViZDoom; local runner/Wiki environments replay their saved trajectories. No game episode is cut short.
- Attach this video while quoting https://x.com/CompleteSkeptic/status/2099925682726002904 using `quote-post.txt`.

Each video has an English `.vtt` caption file, plain-text transcript and poster. The videos are deliberately understandable with sound off. Inputs shown on screen are concise excerpts; complete bound requests and predictions are retained in the demo catalog. The showcase selects successful examples and does not estimate general success rates or inference speed.

Source attribution: the quoted post introduces TypeSafe's Jev and its proprietary RLCD method. Open-Jev is an independent implementation inspired by Jev; these drafts do not repeat the original post's speed/cost claims or imply reproduction of RLCD.

## Release links

- Code: https://github.com/Zefan-Cai/Open-Jev
- Data: https://huggingface.co/datasets/ZefanCai/Open-Jev
- 2B: https://huggingface.co/ZefanCai/Open-Jev-2B
- 9B: https://huggingface.co/ZefanCai/Open-Jev-9B
- Demos: https://zefan-cai.github.io/open-jev/

Model releases contain trained LoRA adapters and the decision head, with pinned upstream Qwen weights required. Dataset cards disclose the redistribution projection and reconstruction instructions. Check the saved release verification reports before sending either draft.

## Reproduce

Run `python3 scripts/render_launch_videos.py` with Pillow, ffmpeg and ffprobe installed. No model, GPU or new inference is used. `video-evidence.json` binds the render script, selected catalog and source gameplay records. Original evaluation records remain unchanged.
