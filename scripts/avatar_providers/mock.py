from __future__ import annotations

from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

from .base import ImageResult, ReviewResult

STATE_ACCENTS = {
    "idle": "#9cff9d",
    "thinking": "#bca7ff",
    "focused": "#8fd7ff",
    "happy": "#ffd166",
    "alert": "#ff6b6b",
    "sleepy": "#a6b1c2",
}


class MockAvatarImageProvider:
    name = "mock"

    def _palette(self, job: dict[str, Any]) -> list[str]:
        locked = job.get("generation", {}).get("locked", {})
        palette = locked.get("paletteHex") or ["#0a0820", "#263142", "#596575", "#9ca7aa", "#315c3b", "#9cff9d", "#fdfcff"]
        return [str(x) for x in palette]

    def _draw_anchor(self, job: dict[str, Any], state: str, out: Path) -> ImageResult:
        palette = self._palette(job)
        outline = job.get("generation", {}).get("locked", {}).get("outlineHex", palette[0])
        stone = palette[2] if len(palette) > 2 else "#596575"
        shade = palette[1] if len(palette) > 1 else "#263142"
        glow = STATE_ACCENTS.get(state, palette[-2] if len(palette) > 1 else "#9cff9d")
        eye = palette[-1] if palette else "#fdfcff"
        im = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        # Stable, deliberately simple mascot: same silhouette, state-specific accents only.
        d.ellipse((154, 220, 358, 404), fill=stone, outline=outline, width=10)
        d.ellipse((176, 128, 336, 282), fill=stone, outline=outline, width=10)
        d.ellipse((206, 74, 306, 164), fill=shade, outline=outline, width=8)
        d.ellipse((114, 248, 190, 344), fill=shade, outline=outline, width=8)
        d.ellipse((322, 248, 398, 344), fill=shade, outline=outline, width=8)
        d.ellipse((216, 188, 236, 210), fill=eye)
        d.ellipse((276, 188, 296, 210), fill=eye)
        d.ellipse((226, 276, 286, 336), fill=glow, outline=outline, width=5)
        if state == "thinking":
            d.text((330, 108), "?", fill=glow)
        elif state == "focused":
            d.line((214, 180, 238, 174), fill=outline, width=5)
            d.line((274, 174, 298, 180), fill=outline, width=5)
        elif state == "happy":
            d.arc((224, 202, 292, 250), 15, 165, fill=eye, width=5)
        elif state == "alert":
            d.line((368, 130, 390, 96), fill=glow, width=6)
            d.line((390, 96, 386, 138), fill=glow, width=6)
        elif state == "sleepy":
            d.line((214, 198, 238, 202), fill=eye, width=5)
            d.line((274, 202, 298, 198), fill=eye, width=5)
            d.text((330, 104), "Z", fill=glow)
        out.parent.mkdir(parents=True, exist_ok=True)
        im.save(out)
        return ImageResult(path=out, provider=self.name, metadata={"state": state, "mock": True})

    def generate_identity_anchor(self, job: dict[str, Any], out_dir: Path) -> ImageResult:
        return self._draw_anchor(job, "idle", out_dir / "identity-00.png")

    def generate_state_anchor(self, job: dict[str, Any], state: str, identity_anchor: Path, out_dir: Path) -> ImageResult:
        return self._draw_anchor(job, state, out_dir / f"{state}-00.png")

    def edit_frame_delta(self, job: dict[str, Any], state: str, frame_plan: dict[str, Any], source_image: Path, out_dir: Path) -> ImageResult:
        out = out_dir / f"{state}-{int(frame_plan.get('index', 0)):02d}-mock-repair.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        im = Image.open(source_image).convert("RGBA")
        # Mark mock repairs with a tiny palette-safe corner spark so tests can
        # confirm the provider repair hook was used without changing identity.
        draw = ImageDraw.Draw(im)
        palette = self._palette(job)
        color = palette[-2] if len(palette) > 1 else "#9cff9d"
        draw.ellipse((im.width - 42, 24, im.width - 22, 44), fill=color)
        im.save(out)
        return ImageResult(path=out, provider=self.name, metadata={"state": state, "framePlan": frame_plan, "mock": True, "repair": True})

    def review_contact_sheet(self, job: dict[str, Any], contact_sheet: Path, rubric: dict[str, Any]) -> ReviewResult:
        return ReviewResult(ok=True, score=1.0, failures=[], metadata={"provider": self.name, "contactSheet": str(contact_sheet)})
