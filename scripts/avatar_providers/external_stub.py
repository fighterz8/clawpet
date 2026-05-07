from __future__ import annotations

from pathlib import Path
from typing import Any

from .base import ImageResult, ReviewResult


class ExternalAvatarImageProvider:
    """Placeholder for real image providers.

    Preferred future concrete backends:
    - OpenAI gpt-image-2
    - Gemini gemini-3.1-flash-image-preview

    This class intentionally fails rather than pretending generation happened.
    """

    def __init__(self, name: str):
        self.name = name

    def _unavailable(self) -> RuntimeError:
        return RuntimeError(
            f"provider '{self.name}' is declared but not implemented yet. "
            "Use provider 'mock' for offline tests or provide manual anchors with provider 'none'. "
            "Planned production targets: OpenAI gpt-image-2 and Gemini gemini-3.1-flash-image-preview."
        )

    def generate_identity_anchor(self, job: dict[str, Any], out_dir: Path) -> ImageResult:
        raise self._unavailable()

    def generate_state_anchor(self, job: dict[str, Any], state: str, identity_anchor: Path, out_dir: Path) -> ImageResult:
        raise self._unavailable()

    def edit_frame_delta(self, job: dict[str, Any], state: str, frame_plan: dict[str, Any], source_image: Path, out_dir: Path) -> ImageResult:
        raise self._unavailable()

    def review_contact_sheet(self, job: dict[str, Any], contact_sheet: Path, rubric: dict[str, Any]) -> ReviewResult:
        raise self._unavailable()
